"""
附件上傳的處理與把關

三件事，缺一不可：

  ① **真實類型**：讀 magic bytes，不信副檔名。
     把 evil.html 改名成 photo.jpg 上傳，日後任何一處直接回傳這個檔案
     就是儲存型 XSS。副檔名是使用者說了算的，magic bytes 不是。

  ② **圖片重新編碼**：用 Pillow 解碼再存一次。
     順便剝掉 EXIF——現場照片的 EXIF 帶 GPS 座標，
     那是公司工地位置的資料，沒必要跟著檔案外流。

  ③ **縮圖**：手機拍的照片動輒 4–8MB，長邊限 2000px 後通常剩 300–600KB。
     8GB 主機的磁碟不是無限的，而且工地是用 4G 看照片。
"""
import hashlib
import io
import logging
from pathlib import Path

from django.conf import settings
from django.core.files.uploadedfile import InMemoryUploadedFile

from main.apps.core.models.attachment import PREVIEWABLE_MIME
from main.utils.exceptions import BusinessRuleError

logger = logging.getLogger("tjg")

#: 副檔名 → 允許的真實 MIME。
#: 一個副檔名可能對到多個（xlsx 在某些系統會被認成 zip，因為它本來就是 zip）。
EXT_MIME = {
    "pdf": {"application/pdf"},
    "jpg": {"image/jpeg"},
    "jpeg": {"image/jpeg"},
    "png": {"image/png"},
    "xlsx": {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/zip",  # xlsx 本體就是 zip，libmagic 有時只認得到這層
    },
    # DWG 沒有標準 MIME，各版本的 magic bytes 也不同。
    # 這種格式無法預覽、只能下載，而下載一律帶 Content-Disposition: attachment，
    # 瀏覽器不會執行它——放寬到只檢查大小與副檔名是可以接受的。
    "dwg": None,
}

IMAGE_MIME = {"image/jpeg", "image/png"}

#: 照片長邊上限（決策待確認 A3）。2000px 印 A4 綽綽有餘，看缺失更是夠。
MAX_IMAGE_EDGE = 2000
JPEG_QUALITY = 85


def _detect_mime(chunk: bytes) -> str:
    """讀檔頭判定真實類型。libmagic 沒裝時退回空字串而不是炸掉。"""
    try:
        import magic

        return magic.from_buffer(chunk, mime=True) or ""
    except Exception:  # pragma: no cover - 只在系統缺 libmagic1 時走到
        logger.warning("libmagic 不可用，附件類型檢查降級為只檢查副檔名")
        return ""


def process_upload(uploaded_file):
    """檢查並（必要時）重新編碼上傳的檔案。

    回傳 `(檔案物件, {mime_type, size_bytes, checksum, is_previewable})`。
    任何一項不合格就丟 BusinessRuleError，訊息直接寫給使用者看。
    """
    ext = Path(uploaded_file.name or "").suffix.lower().lstrip(".")
    if ext not in settings.ALLOWED_UPLOAD_EXTENSIONS:
        allowed = "、".join(settings.ALLOWED_UPLOAD_EXTENSIONS)
        raise BusinessRuleError(f"不支援的檔案類型「{ext or '未知'}」。僅接受：{allowed}")

    if uploaded_file.size > settings.MAX_UPLOAD_SIZE:
        raise BusinessRuleError(
            f"檔案 {uploaded_file.size / 1024 / 1024:.1f}MB 超過上限 "
            f"{settings.MAX_UPLOAD_SIZE_MB}MB。若是圖說，請壓縮或分次上傳"
        )

    uploaded_file.seek(0)
    head = uploaded_file.read(4096)
    uploaded_file.seek(0)
    mime = _detect_mime(head)

    expected = EXT_MIME.get(ext)
    if expected and mime and mime not in expected:
        # 這句話刻意講清楚是「內容」不符，不是「副檔名」不支援——
        # 使用者才知道問題不是改個副檔名就能解決的
        raise BusinessRuleError(
            f"檔案內容與副檔名不符：副檔名是 .{ext}，但實際內容是 {mime}。"
            "請確認檔案沒有被改過副檔名"
        )
    if not mime:
        mime = uploaded_file.content_type or "application/octet-stream"

    if mime in IMAGE_MIME:
        uploaded_file, mime = _reencode_image(uploaded_file, mime)

    checksum = _sha256(uploaded_file)
    return uploaded_file, {
        "mime_type": mime,
        "size_bytes": uploaded_file.size,
        "checksum": checksum,
        "is_previewable": mime in PREVIEWABLE_MIME,
    }


def _reencode_image(uploaded_file, mime):
    """解碼再編碼一次：剝掉 EXIF、限制長邊。

    Pillow 沒裝或圖片壞掉時原樣放行——附件功能不該因為壓縮失敗就整個不能用，
    但**必須留下記錄**，否則 EXIF 沒剝掉這件事沒有人會知道。
    """
    try:
        from PIL import Image, ImageOps
    except ImportError:  # pragma: no cover
        logger.warning("Pillow 未安裝，圖片未重新編碼（EXIF 未剝除）")
        return uploaded_file, mime

    try:
        uploaded_file.seek(0)
        image = Image.open(uploaded_file)
        # 手機拍的照片是「橫著存、用 EXIF 標示要轉」。剝掉 EXIF 前要先轉正，
        # 否則照片會躺著——這是剝 EXIF 最常見的副作用
        image = ImageOps.exif_transpose(image)

        if image.mode in ("RGBA", "P", "LA") and mime == "image/jpeg":
            image = image.convert("RGB")
        image.thumbnail((MAX_IMAGE_EDGE, MAX_IMAGE_EDGE), Image.LANCZOS)

        buffer = io.BytesIO()
        if mime == "image/png":
            image.save(buffer, format="PNG", optimize=True)
        else:
            image.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        buffer.seek(0)

        # 這裡新建的 Image 物件不帶原始 exif，等於已經剝除
        return InMemoryUploadedFile(
            buffer, "file", uploaded_file.name, mime, buffer.getbuffer().nbytes, None
        ), mime
    except Exception:
        logger.warning("圖片重新編碼失敗，原檔放行：%s", uploaded_file.name, exc_info=True)
        uploaded_file.seek(0)
        return uploaded_file, mime


def _sha256(uploaded_file) -> str:
    """分塊算，不要把整個檔案讀進記憶體——25MB × 3 workers 就是 75MB。"""
    digest = hashlib.sha256()
    uploaded_file.seek(0)
    for chunk in iter(lambda: uploaded_file.read(65536), b""):
        digest.update(chunk)
    uploaded_file.seek(0)
    return digest.hexdigest()
