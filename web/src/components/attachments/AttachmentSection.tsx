/**
 * 附件區塊
 *
 * 掛在既有畫面上，不新增分頁（決策 D09：一件事一個入口）。
 * 專案頁、追蹤單元面板、請款事件三處共用同一個元件——
 * 三種東西的附件操作是一樣的，沒有理由寫三次。
 *
 * 兩個刻意的設計：
 *   · 不能預覽的檔案**不顯示預覽按鈕**，直接寫出為什麼要下載。
 *     按了才跳出「無法預覽」比一開始就講清楚更糟。
 *   · 手機上「拍照」與「選檔」分成兩顆。現場人員最常做的是拍照，
 *     不該讓他在檔案總管裡找相機。
 */
import {
  Camera,
  Eye,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  PenTool,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import {
  attachmentUrl,
  useAttachments,
  useDeleteAttachment,
  useUploadAttachment,
} from "@/api/hooks";
import { ApiError } from "@/api/client";
import type { Attachment, AttachmentTarget } from "@/api/types";
import { Button, EmptyState, Modal, Select, Spinner } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";

const ICONS: Record<string, typeof FileText> = {
  pdf: FileText,
  jpg: ImageIcon,
  jpeg: ImageIcon,
  png: ImageIcon,
  xlsx: FileSpreadsheet,
  dwg: PenTool,
};

export default function AttachmentSection({
  target,
  id,
  title = "檔案",
  defaultCategory = "other",
  compact = false,
}: {
  target: AttachmentTarget;
  id: number;
  title?: string;
  /** 掛在哪就預設哪一類：專案→合約、追蹤單元→現場照片、請款→發票 */
  defaultCategory?: string;
  compact?: boolean;
}) {
  const { data, isLoading } = useAttachments(target, id);
  const upload = useUploadAttachment(target, id);
  const remove = useDeleteAttachment(target, id);
  const toast = useToast();

  const [category, setCategory] = useState(defaultCategory);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const rows = data?.results ?? [];

  function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    // 一次選多個就一個一個傳。合併成一次請求需要後端也支援，
    // 而且失敗時分不出是哪一個檔案的問題
    for (const file of Array.from(files)) {
      upload.mutate(
        { file, category },
        {
          onSuccess: (result) => toast.success(`已上傳「${result.original_name}」`),
          onError: (error) =>
            toast.error(error instanceof ApiError ? error.message : "上傳失敗"),
        },
      );
    }
    if (fileInput.current) fileInput.current.value = "";
    if (cameraInput.current) cameraInput.current.value = "";
  }

  function handleDelete(row: Attachment) {
    if (!confirm(`確定刪除「${row.original_name}」？檔案會一併從主機移除。`)) return;
    remove.mutate(row.id, {
      onSuccess: () => toast.success("已刪除"),
      onError: (error) => toast.error(error instanceof ApiError ? error.message : "刪除失敗"),
    });
  }

  if (isLoading) return <Spinner label="載入檔案…" />;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-ink">
          <Paperclip size={14} className="text-ink-3" />
          {title}
          {rows.length > 0 && <span className="text-ink-3">（{rows.length}）</span>}
        </h3>
      </div>

      {rows.length === 0 ? (
        compact ? (
          <p className="mb-2 text-xs text-ink-3">還沒有檔案</p>
        ) : (
          <EmptyState
            title="還沒有檔案"
            hint="合約、施工圖、時程表、現場照片都可以放在這裡。跟這個案子有關的東西，之後在這裡就找得到"
          />
        )
      ) : (
        <ul className="divide-y divide-line rounded-xl bg-card ring-1 ring-line">
          {rows.map((row) => (
            <AttachmentRow
              key={row.id}
              row={row}
              onPreview={() => setPreview(row)}
              onDelete={() => handleDelete(row)}
              deleting={remove.isPending}
            />
          ))}
        </ul>
      )}

      {data?.can_upload && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={category}
              onChange={setCategory}
              options={data.categories}
              className="text-xs"
            />
            {/* capture 讓手機直接開相機。桌機瀏覽器會忽略它，行為跟一般選檔一樣 */}
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={data.allowed_extensions.map((e) => `.${e}`).join(",")}
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button onClick={() => cameraInput.current?.click()} disabled={upload.isPending}>
              <Camera size={15} />
              拍照
            </Button>
            <Button
              variant="primary"
              onClick={() => fileInput.current?.click()}
              loading={upload.isPending}
            >
              <Upload size={15} />
              選檔上傳
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-ink-3">
            可傳 {data.allowed_extensions.join("、")}，單檔上限 {data.max_size_mb}MB。
            照片會自動壓縮並移除拍攝位置資訊
          </p>
        </div>
      )}

      <PreviewModal attachment={preview} onClose={() => setPreview(null)} />
    </section>
  );
}

function AttachmentRow({
  row,
  onPreview,
  onDelete,
  deleting,
}: {
  row: Attachment;
  onPreview: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const Icon = ICONS[row.ext] ?? Paperclip;
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <Icon size={17} className="mt-0.5 shrink-0 text-ink-3" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{row.original_name}</p>
        <p className="mt-0.5 text-xs text-ink-3">
          {row.category_label} · {row.size_display} ·{" "}
          {new Date(row.uploaded_at).toLocaleDateString("zh-TW")}
          {row.uploaded_by_name && ` · ${row.uploaded_by_name}`}
        </p>
        {row.note && <p className="mt-0.5 text-xs text-ink-2">{row.note}</p>}
        {/* 不能預覽時把原因寫出來，而不是給一顆按了會失望的按鈕 */}
        {!row.is_previewable && (
          <p className="mt-1 text-xs leading-snug text-ink-3">{row.no_preview_reason}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {row.is_previewable && (
          <IconButton label="預覽" onClick={onPreview}>
            <Eye size={15} />
          </IconButton>
        )}
        <a
          href={attachmentUrl(row.id)}
          className="rounded-lg p-1.5 text-ink-2 hover:bg-page"
          title="下載"
          aria-label={`下載 ${row.original_name}`}
        >
          <Upload size={15} className="rotate-180" />
        </a>
        {row.can_delete && (
          <IconButton label="刪除" onClick={onDelete} disabled={deleting}>
            <Trash2 size={15} />
          </IconButton>
        )}
      </div>
    </li>
  );
}

function IconButton({
  label,
  children,
  ...rest
}: { label: string; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="rounded-lg p-1.5 text-ink-2 hover:bg-page disabled:opacity-40"
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * 預覽
 *
 * PDF 用 `<object>`、圖片用 `<img>`，都是瀏覽器原生能力——
 * 不引入 PDF.js 之類的函式庫。那會讓前端 bundle 多好幾百 KB，
 * 換來的只是「跟瀏覽器內建看起來一樣」的東西。
 */
function PreviewModal({
  attachment,
  onClose,
}: {
  attachment: Attachment | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  if (!attachment) return null;

  const src = attachmentUrl(attachment.id, true);
  const isImage = attachment.mime_type.startsWith("image/");

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/80"
      onClick={onClose}
      role="presentation"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <p className="truncate text-sm font-semibold">{attachment.original_name}</p>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href={attachmentUrl(attachment.id)}
            className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold"
            onClick={(e) => e.stopPropagation()}
          >
            下載
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉預覽"
            className="rounded-lg bg-white/15 p-1.5"
          >
            <X size={18} />
          </button>
        </div>
      </div>
      <div
        className="flex flex-1 items-center justify-center overflow-auto p-2 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {loading && (
          <Loader2 size={24} className="absolute animate-spin text-white/70" aria-hidden />
        )}
        {isImage ? (
          <img
            src={src}
            alt={attachment.original_name}
            onLoad={() => setLoading(false)}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <object
            data={src}
            type={attachment.mime_type}
            onLoad={() => setLoading(false)}
            className="h-full w-full rounded-lg bg-white"
            aria-label={attachment.original_name}
          >
            {/* 瀏覽器不支援內嵌 PDF 時的退路。手機瀏覽器常見 */}
            <div className="flex h-full items-center justify-center p-6 text-center text-sm">
              <p>
                這個瀏覽器不支援內嵌預覽。
                <a href={attachmentUrl(attachment.id)} className="ml-1 font-semibold underline">
                  改用下載
                </a>
              </p>
            </div>
          </object>
        )}
      </div>
    </div>
  );
}

/** 用在請款事件卡片：只有一顆迴紋針，點了才展開 */
export function AttachmentBadge({
  target,
  id,
  label,
}: {
  target: AttachmentTarget;
  id: number;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs
                   font-semibold text-ink-2 ring-1 ring-line hover:bg-page"
      >
        <Paperclip size={12} />
        檔案
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={label}>
        {/* 沒開之前不掛載，就不會為了畫一顆迴紋針去打一次 API */}
        {open && <AttachmentSection target={target} id={id} defaultCategory="invoice" compact />}
      </Modal>
    </>
  );
}
