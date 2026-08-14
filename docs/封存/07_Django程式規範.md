# Standards

- Project
    
    命名規則：**`{platform.name}-{system.name}`**
    
    ```
    **{platform.name}-{system.name}**
    ├── .dockerignore
    ├── .env
    ├── .env.sample
    ├── .gitignore
    ├── docker-compose.yml問
    ├── Dockerfile
    ├── logs
    ├── main
    │   ├── apps
    │   │   └── __init__.py
    │   ├── asgi.py
    │   ├── __init__.py
    │   ├── settings
    │   │   ├── __init__.py
    │   │   ├── base.py
    │   │   ├── local.py
    │   │   ├── production.py
    │   │   └── test.py
    │   ├── urls.py
    │   ├── utils
    │   │   └── __init__.py
    │   └── wsgi.py
    ├── manage.py
    ├── README.MD
    ├── requirements
    │   ├── base.txt
    │   ├── local.txt
    │   ├── production.txt
    │   └── test.txt
    └── shell
        └── create_django_app.sh
    ```
    
    1. docker-compose.yml、Dockerfile 用來建立部屬環境
    2. logs中放 system logs，按日分檔案， 可以在utils中放入 log decorator
    3. .gitignore 內容如連結
    4. main 為 project 主資料夾
        1. apps 為元件一覽表的module ，詳情見下方Rules中的Apps
        2. wsgi.py、asgi.py 溝通外部與python server，將request、response 中的data做轉換
            - wsgi.py: `DJANGO_SETTINGS_MODULE`要改成環境變數
                
                ```python
                """
                WSGI config for model_dev project.
                
                It exposes the WSGI callable as a module-level variable named ``application``.
                
                For more information on this file, see
                https://docs.djangoproject.com/en/4.1/howto/deployment/wsgi/
                """
                
                import os
                from dotenv import load_dotenv
                from django.core.wsgi import get_wsgi_application
                
                load_dotenv()
                os.environ.setdefault('DJANGO_SETTINGS_MODULE',
                                      os.environ.get('DJANGO_SETTINGS_MODULE'))
                
                application = get_wsgi_application()
                ```
                
        3. settings分 base (共用的設定), local (繼承base，加上本地開發需要的設定), production (繼承base，加上部屬需要的設定), test (繼承base，加上測試需要的設定)
            - main/settings/base.py 中的 SECRET_KEY 應該要寫在 .env
                - How to protect your Django Secret and OAuth Keys
                    
                    Reference: https://dev.to/vladyslavnua/how-to-protect-your-django-secret-and-oauth-keys-53fl, https://chat.openai.com/share/40ebbeff-922b-428b-8178-c1f9bf9309ad
                    
        4. utils 放置整個project 可以使用的工具，如logs產生器
        5. urls 放置全部module 的母路徑，並且include 所有module，domain_name不含system_name（不想公開）
            - version從v0.1開始
            
            ```
            <domain_name>/api/<version>/
            ```
            
    5. manage.py 是 Django 專案中的命令列工具，用於執行各種與專案相關的任務
        - manage.py: `DJANGO_SETTINGS_MODULE`是環境變數，開發用 local、測試用test、生產環境用production
            
            ```python
            #!/usr/bin/env python
            """Django's command-line utility for administrative tasks."""
            import os
            import sys
            from dotenv import load_dotenv
            
            load_dotenv()
            
            def main():
                """Run administrative tasks."""
                os.environ.setdefault('DJANGO_SETTINGS_MODULE',
                                      os.environ.get('DJANGO_SETTINGS_MODULE'))
                try:
                    from django.core.management import execute_from_command_line
                except ImportError as exc:
                    raise ImportError(
                        "Couldn't import Django. Are you sure it's installed and "
                        "available on your PYTHONPATH environment variable? Did you "
                        "forget to activate a virtual environment?"
                    ) from exc
                execute_from_command_line(sys.argv)
            
            if __name__ == '__main__':
                main()
            ```
            
    6. README.MD 使用markdown撰寫project 說明
        1. Readme留工作log，欄位時間描述
    7. requirement分 base (共用的套件), local (繼承base，加上本地開發需要的套件), production (繼承base，加上部屬需要的套件), test (繼承base，加上測試需要的套件)
    8. shell 中的create_django_app.sh 提供快速建立app 的腳本，也可以開發其他腳本
    9. .env
        - 需要註明溝通的protocal (http or https)
        - default 的紅色部分可以選用
        - HARBOR 部分可以放，開發模組使用的第三方程式client需要的資訊
            - 如mysql、kubeflow
        - central-layer.ai_ml_mt.model_dev.ml_img_mgt
            - 在註解中放入自身模組與需要call api的模組資訊
        - example
            
            ```bash
            # =====================================================
            # Default 
            # =====================================================
            LOGS_FOLDER_PATH=./logs/
            SECRET_KEY=
            DJANGO_SETTINGS_MODULE=main.settings.local
            DEBUG=True
            ALLOWED_HOSTS=
            API_ROOT=api
            HOST_PASSWORD=
            # =====================================================
            # HARBOR 
            # =====================================================
            HTTP_HARBOR_HOST=
            HTTP_HARBOR_PORT=
            HTTP_HARBOR_USER=
            HTTP_HARBOR_PASSWORD=
            # =====================================================
            # central-layer.ai_ml_mt.model_dev.ml_img_mgt
            # =====================================================
            HTTP_ML_IMG_MGT_HOST_IP=
            HTTP_ML_IMG_MGT_PORT=
            HTTP_ML_IMG_MGT_NAME=ml_img_mgt
            HTTP_ML_IMG_MGT_VERSION=
            # =====================================================
            # central-layer.ai_ml_oom.file_mgt.file_operation
            # =====================================================
            HTTP_FILE_OPERATION_HOST_IP=
            HTTP_FILE_OPERATION_PORT=
            HTTP_FILE_OPERATION_NAME=file_operation
            HTTP_FILE_OPERATION_VERSION=
            ```
            
- Apps
    
    ```
     ── ml_img_mgt
        ├── actors
        │   ├── PreprocessingRunner.py
        │   ├── __init__.py
        ├── admin.py
        ├── api
        │   ├── __init__.py
        │   ├── urls.py
        │   └── views
        │       ├── __init__.py
        │       └── views.py
        ├── apps.py
        ├── __init__.py
        ├── migrations
        │   └── __init__.py
        ├── models
        │   ├── __init__.py
        │   └── {table.name}.py
        ├── serializers
        │   └── __init__.py
        ├── services
        │   └── __init__.py
        ├── templates
        │   └── __init__.py
        └── tests
            ├── __init__.py
            └── test_actors.py
    ```
    
    1. actors 裡面每個actors 都有一個python file ，裡面的function 使用一或多個service function做業務邏輯處理，檔案命名用Class的寫法，即CamelCase
        - example of actor function(use django sdk to response，do not use restframe work)
            
            ```python
            from django.http import HttpResponse
            from django.views.decorators.http import require_POST
            
            @require_POST
            def my_view(request):
                return HttpResponse('This is a POST request.')
            ```
            
    2. admin.py 文件是 Django 项目中用于配置 Django 管理后台（Admin Site）的地方
    3. app.py 用於儲存與Module (Django APP)相關的配置訊息，使該Module 可以在setting中被引用 (INSTALLED_APPS)
    4. templates, view先保留，用來開發測試用 (與前端有關)
    5. api 中的urls 撰寫該module負責的api，並且提供給main 中urls.py include
        - 最後面不要有”/”
        
        ```bash
        <模組app>/<組件actor, view>/<元件service>
        ```
        
    6. 有db，才需要models, migrations,  serializers
        1. models 撰寫table規範，每個table都要各自對應到一個python file，命名規則為`{table.name}.py`d需要更改__init__.py
        
        - **init.**py
            
            ```bash
            from .models import *
            ```
            
        1. migrations 記錄model 更新的紀錄
        2. serializers 負責將資料做格式轉換(JSON to list or dict)
    7. service可以是會被module反覆使用的商業邏輯，可以想成module 的 library
    8. tests 寫單元測試的地方
        - 檔案名稱使用 test_actors.py
        - 檔案內放要測試的 actor，一個 actor一個 class，名字Test<Actor.name>
        - test_actors.py
            
            ```python
            """
            test api
            """
            import json
            from django.test import TestCase, Client
            
            class Test<Actor.name>(TestCase):
                """
                test actor
                """
            
                def setUp(self):
                    """
                    intial unit test request
                    """
                    self.client = Client()
            
                def test_<function.name>(self):
                    """
                    pass
                    """
                    response = self.client.post(
                        path="http://<your url include host ip>:<port>/<your api path>",
                        data=json.dumps({'test': '123', "test2": "1234"}),
                        content_type='application/json'
                    )
                    self.assertEqual(response.status_code, 200)
            ```
            
        - 參考用的prompt，可以產生一個參考初版，歡迎建議更好的prompt。產生的內容，可以放到tests底下的README.md
            
            ```
            作為一個專業的Django測試工程師，請基於以下 function 描述
            ```
            function名字：genr_param_tune_img
            
            function目的：協助AI/ML model training 平台使用者生成python docker image供自動調參數使用
            
            function input：
            python檔案
            
            Json Data:
            docker file的獲取方式
            
            function內部行為：
            1. 將輸入的 docker file  建立成 docker image
            
            function output：
            docker image名稱、docker image
            ```
            寫這個function的test case，其中要盡可能包含：正常情況（正常輸入/輸出）、邊界情況、異常情況（例如，錯誤輸入或錯誤處理）
            test case格式包含描述、輸入、預期輸出，使用英文撰寫
            
            例子：
            ```
            # Function: {function.name}
            
            ## 正常情況
            
            ### Test Case 1: 正常生成 Docker Image
            
            - 測試函數名稱: test_...
            - **描述**: ...
            - **輸入**:
              - ...
            - **預期輸出**:
              - ...
            
            ## 邊界情況
            ...
            
            ## 異常情況
            ...
            ```
            
            請注意以下規則：
            1. 使用Markdown格式
            2. 如果你需要其它的資訊來完善你的答覆或你認為這個function描述不合理，請隨時提醒我。
            3. 不確定的內容，請明確回答不確定。
            ```
            
        - README.md Example
            
            ```markdown
            # 函數: MlImgManager.genr_preprocessing_img
            
            ## 正常情況
            
            ### 測試案例 1: 正常生成 Docker Image
            
            - 測試函數名稱: test_genr_preprocessing_img_normal
            - **描述**: 當提供正確的JSON資料時，應該解析JSON，通過API獲取Dockerfile，構建Docker image，並將Image名稱儲存至資料庫。
            - **輸入**:
              - Json Data: 正確格式的JSON，包含獲取Dockerfile的資訊。
            - **預期輸出**:
              - Docker image名稱: 符合預定義格式的字符串。
              - Docker image: 正確構建的Docker image對象。
            
            ## 邊界情況
            
            ### 測試案例 2: JSON資料為邊界條件
            
            - 測試函數名稱: test_genr_preprocessing_img_boundary
            - **描述**: 當JSON資料是邊界條件（如空JSON、極大或極小的資料集）時，應正確處理。
            - **輸入**:
              - Json Data: `{}`（空的JSON對象）
            - **預期輸出**:
              - 錯誤訊息或異常，指明不能處理空的JSON資料。
            
            ## 異常情況
            
            ### 測試案例 3: JSON資料格式不正確
            
            - 測試函數名稱: test_genr_preprocessing_img_invalid_json
            - **描述**: 如果JSON資料格式不正確，應拋出解析錯誤。
            - **輸入**:
              - Json Data: `"This is not a JSON"`
            - **預期輸出**:
              - 錯誤訊息或異常，指明JSON格式不正確。
            
            ### 測試案例 4: API無法獲取Dockerfile
            
            - 測試函數名稱: test_genr_preprocessing_img_api_fail
            - **描述**: 如果從API無法獲取Dockerfile，應拋出相關錯誤。
            - **輸入**:
              - Json Data: 正確格式的JSON，但API無法處理。
            - **預期輸出**:
              - 錯誤訊息或異常，指明無法從API獲取Dockerfile。
            
            # 函數: genr_training_img
            
            ## 正常情況
            
            ### 測試案例 1: 正常生成 Docker Image
            
            - 測試函數名稱: test_genr_training_img_normal
            - **描述**: 當提供正確的JSON資料時，應該解析JSON，通過API獲取Dockerfile，構建Docker image，並將Image名稱儲存至資料庫。
            - **輸入**:
              - Json Data: 正確格式的JSON，包含獲取Dockerfile的資訊。
            - **預期輸出**:
              - Docker image名稱: 符合預定義格式的字符串。
              - Docker image: 正確構建的Docker image對象。
            
            ## 邊界情況
            
            ### 測試案例 2: JSON資料為邊界條件
            
            - 測試函數名稱: test_genr_training_img_boundary
            - **描述**: 當JSON資料是邊界條件（如空JSON、極大或極小的資料集）時，應正確處理。
            - **輸入**:
              - Json Data: `{}`（空的JSON對象）
            - **預期輸出**:
              - 錯誤訊息或異常，指明不能處理空的JSON資料。
            
            ## 異常情況
            
            ### 測試案例 3: JSON資料格式不正確
            
            - 測試函數名稱: test_genr_training_img_invalid_json
            - **描述**: 如果JSON資料格式不正確，應拋出解析錯誤。
            - **輸入**:
              - Json Data: `"This is not a JSON"`
            - **預期輸出**:
              - 錯誤訊息或異常，指明JSON格式不正確。
            
            ### 測試案例 4: API無法獲取Dockerfile
            
            - 測試函數名稱: test_genr_training_img_api_fail
            - **描述**: 如果從API無法獲取Dockerfile，應拋出相關錯誤。
            - **輸入**:
              - Json Data: 正確格式的JSON，但API無法處理。
            - **預期輸出**:
              - 錯誤訊息或異常，指明無法從API獲取Dockerfile。
            ```
            

# Quick Version (No DB)

- a. Python virtual environment
    
    ```bash
    mkdir .venv
    sudo apt install python3.8-venv -y
    python3 -m venv .venv
    source .venv/bin/activate
    pip install --upgrade pip
    pip install django==4.1.1
    ```
    
- b. Quick creating django
    
    copy start_project.sh into your file system
    
    - start_project.sh
        
        ```bash
        #!/bin/bash
        
        # Get the project name input from the user
        echo -n "Please enter your Django project name: "
        read project_name
        
        # Check if the project_name is empty
        if [ -z "$project_name" ]; then
            echo "Project name cannot be empty!"
            exit 1
        fi
        
        # Create a Django project using the user input project_name
        django-admin startproject $project_name
        mv $project_name/$project_name $project_name/main
        
        # Create required files and directories
        mkdir $project_name/requirements
        touch $project_name/requirements/base.txt
        touch $project_name/requirements/local.txt
        touch $project_name/requirements/production.txt
        touch $project_name/requirements/test.txt
        
        # 目標文件URL
        URL="https://raw.githubusercontent.com/github/gitignore/main/Python.gitignore"
        
        # 輸出文件名稱
        OUTPUT="Python.gitignore"
        
        # 使用curl下載.gitignore文件
        curl -o "$OUTPUT" "$URL"
        
        # 檢查命令執行結果
        if [ $? -eq 0 ]; then
            echo "Python.gitignore has been successfully downloaded."
            # 重命名文件
            mv $OUTPUT ./$project_name/.gitignore
            if [ $? -eq 0 ]; then
                echo "Renamed Python.gitignore to .gitignore."
            else
                echo "Failed to rename Python.gitignore to .gitignore."
            fi
        else
            echo "Failed to download Python.gitignore."
        fi
        
        touch $project_name/.dockerignore
        touch $project_name/.env.sample
        touch $project_name/docker-compose.yml
        touch $project_name/Dockerfile
        touch $project_name/README.MD
        
        # Create the shell directory
        mkdir $project_name/shell
        
        # Create the utils directory
        mkdir $project_name/main/utils
        touch $project_name/main/utils/__init__.py
        
        # Create the logs directory
        mkdir $project_name/logs
        
        # Create the apps directory
        mkdir $project_name/main/apps
        touch $project_name/main/apps/__init__.py
        
        # Create the settings directory and move the settings.py file
        mkdir $project_name/main/settings
        touch $project_name/main/settings/__init__.py
        touch $project_name/main/settings/local.py
        touch $project_name/main/settings/production.py
        touch $project_name/main/settings/test.py
        mv $project_name/main/settings.py $project_name/main/settings/base.py
        cat <<- EOM > "$project_name/main/settings/local.py"
        from .base import *
        EOM
        
        # Output success message
        echo "Django project $project_name has been created successfully!"
        
        # After project structure is created, modify configuration in files
        
        # In $project_name/manage.py
        sed -i "9s/$project_name.settings/main.settings.local/" "$project_name/manage.py"
        
        # In $project_name/main/asgi.py
        sed -i "14s/$project_name.settings/main.settings.local/" "$project_name/main/asgi.py"
        
        # In $project_name/main/wsgi.py
        sed -i "14s/$project_name.settings/main.settings.local/" "$project_name/main/wsgi.py"
        
        # In $project_name/main/settings/base.py
        sed -i "52s/$project_name.urls/main.urls/" "$project_name/main/settings/base.py"
        sed -i "70s/$project_name.wsgi.application/main.wsgi.application/" "$project_name/main/settings/base.py"
        
        # Output success message
        echo "Configuration in Django project $project_name has been modified successfully!"
        
        # Name of the new script
        new_script_name="$project_name/shell/create_django_app.sh"
        
        # Create and write to the new script
        cat <<- EOM > $new_script_name
        #!/bin/bash
        
        # Prompt user for the app name
        echo -n "Please enter your Django app name: "
        read app_name
        
        # Check if app_name is empty
        if [ -z "\$app_name" ]; then
            echo "App name cannot be empty!"
            exit 1
        fi
        
        cd ..
        
        # Start the Django app with the user-inputted name
        python manage.py startapp \$app_name
        
        # Create directories and files for the app
        mkdir \$app_name/services
        touch \$app_name/services/__init__.py
        
        mkdir \$app_name/templates
        touch \$app_name/templates/__init__.py
        
        mkdir \$app_name/api
        touch \$app_name/api/__init__.py
        touch \$app_name/api/urls.py
        
        mkdir \$app_name/serializers
        touch \$app_name/serializers/__init__.py
        
        mkdir \$app_name/actors
        touch \$app_name/actors/__init__.py
        
        mkdir \$app_name/api/views
        touch \$app_name/api/views/__init__.py
        mv \$app_name/views.py \$app_name/api/views
        
        mkdir \$app_name/models
        touch \$app_name/models/__init__.py
        mv \$app_name/models.py \$app_name/models
        
        mkdir \$app_name/tests
        mv \$app_name/tests.py \$app_name/tests
        touch \$app_name/tests/__init__.py
        
        # Move the app to main/apps
        mv \$app_name main/apps
        
        # Output success message
        echo "Django app \$app_name has been created and configured successfully!"
        
        # Modify main/<app_name>/apps.py
        sed -i "6s/name = '\$app_name'/name = 'main.apps.\$app_name'/" "main/apps/\$app_name/apps.py"
        
        # Add app to installed apps in main/settings/base.py
        # This assumes that your INSTALLED_APPS section is formatted a certain way
        echo "Adding \$app_name to INSTALLED_APPS in main/settings/base.py"
        sed -i "/INSTALLED_APPS = \[/a \    'main.apps.\$app_name'," "main/settings/base.py"
        
        # Modify main/urls.py to include the app's API URLs
        # This assumes that you want to add this line at the end of the file
        echo "Updating main/urls.py to include API URLs for \$app_name"
        # Add import statement if it doesn't exist
        sed -i "s/from django.urls import path/&, include/" "main/urls.py"
        # Add new path to urlpatterns
        sed -i "/urlpatterns = \[/a \    path('api\/0.1\/', include('main.apps.\$app_name.api.urls'))," "main/urls.py"
        # Output success message
        echo "Files for Django app \$app_name have been modified successfully!"
        EOM
        # Give execute permission to the new script
        chmod +x $new_script_name
        # Notify user of script creation
        echo "Script $new_script_name has been created successfully!"
        ```
        
    
    ```bash
    chmod +x start_project.sh
    ./start_project.sh
    # enter the project name you want
    ```
    
- d. Modify the parameters for the file
    
    go into your apps/<module name>/api/urls.py
    
    enter the content
    
    - urls.py
        
        ```python
        from django.urls import path
        from main.apps.<module name>.actors import <actor name>
        
        urlpatterns = [
            path('<actor name>/', <actor name>.<function name>)
        ]
        # enter your own module into <module name>
        # enter your own actor into <actor name>
        # enter your own function into <function name>
        ```
        
    
    remember add “*” into your ALLOWED_HOSTS in main/settings/base.py
    
- e. Run Django server
    
    ```bash
    python manage.py runserver 0.0.0.0:30303
    ```
    
- f. About ENV
    
    共有兩中ENV包含在Django內
    
    1. local env
        - 用途
            1. 引入common env中的參數，方便部署
            2. 給予程式碼使用的環境變數
            3. 放置敏感資訊，password etc
        - 檔案
            - .env
                - 部署時僅編輯敏感資訊
            - .env.sample
                - 未部署前編輯
    2. common env
        - 用途
            1. 方便server遷移、部署時使用
            2. 給予整層的系統使用
        - 檔案
            - .env.common
                - 部署時編輯
            - .env.common.sample
                - 未部署前編輯
- Issue
    
    Q1.名稱似乎不能與Python module包相同【2023.10.28 建議刪除，正常命名應該不會遇到這問題】
    
    !Untitled
    

# Logs Utils

- rules
    1. When using terminal `python manage.py test`、`python manage.py runserver 0.0.0.0:30303`, make sure your work dir is under <project>
    2. when using `python manage.py test`, make sure your request is post and setting `content_type='application/json’`
    3. log_trigger call as decorator，log_writer call as function
    - requirements
        
        ```
        python-dotenv==1.0.0
        ```
        
- a. creating log utils
    
    copy log.py into <project >/main/utils/logger.py
    
    - logger.py
        
        ```python
        """
        System log utils.
        """
        import os
        import json
        from functools import wraps
        from datetime import datetime
        from dotenv import load_dotenv
        from django.core.handlers.wsgi import WSGIRequest
        
        load_dotenv()
        log_folder_path = os.environ.get('LOGS_FOLDER_PATH')
        
        def ensure_log_folder_exists():
            """Ensure that the logs folder exists."""
            if not os.path.exists(log_folder_path):
                os.makedirs(log_folder_path)
        
        def generate_log_content(log_level, func, args, message=None):
            """
            Generate the log content.
        
            :param log_level: The log level e.g., "INFO", "ERROR", etc.
            :param func: The function that triggers the log.
            :param args: Arguments for the function that triggers the log.
            :param message: Additional log message.
            :return: Formatted log string.
            """
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            module_name = func.__module__.split('.')[-3] if func else "Unknown"
            actor_name = func.__module__.split('.')[-1] if func else "Unknown"
            function_name = func.__name__ if func else "Unknown"
        
            request = args[0] if args else None
            payload = 'Not a Django WSGI Request'
        
            if isinstance(request, WSGIRequest):
                try:
                    payload = json.loads(request.body.decode('utf-8'))
                except json.JSONDecodeError:
                    payload = 'Invalid JSON or empty payload'
        
            log_tail = f"""payload: {payload}""" if message is None else f"""message: {message}"""
        
            return f"""[{log_level}] time: {timestamp}, module: {module_name}, actor: {actor_name}, function: {function_name}, {log_tail}\n"""
        
        def log_trigger(log_level: str):
            """
            Decorator to write logs before calling the api function.
        
            :param log_level: The log level e.g., "INFO", "ERROR", etc.
            :return: decorator function.
            """
            def decorator(func):
                @wraps(func)
                def wrapper(*args, **kwargs):
                    ensure_log_folder_exists()
                    log_file_name = f"""{datetime.now().strftime('%Y-%m-%d')}_log.txt"""
                    log_file_path = os.path.join(log_folder_path, log_file_name)
        
                    log_content = generate_log_content(log_level, func, args)
        
                    with open(log_file_path, "a", encoding="utf8") as file:
                        file.write(log_content)
        
                    return func(*args, **kwargs)
        
                return wrapper
        
            return decorator
        
        def log_writer(log_level: str, func=None, args=None, message=None):
            """
            Write logs. It can be used during the execution of api function or at the end of execution.
        
            :param log_level: The log level e.g., "INFO", "ERROR", etc.
            :param func: The function that triggers the log.
            :param args: Arguments for the function that triggers the log..
            :param message: Additional log message.
            """
            ensure_log_folder_exists()
            log_file_name = f"""{datetime.now().strftime('%Y-%m-%d')}_log.txt"""
            log_file_path = os.path.join(log_folder_path, log_file_name)
        
            log_content = generate_log_content(log_level, func, args, message)
        
            with open(log_file_path, "a", encoding="utf8") as file:
                file.write(log_content)
        ```
        
- b. setting .env log folder path
    - .env
        
        ```python
        LOGS_FOLDER_PATH=./logs/
        ```
        
- c. creating actor function
    
    copy actor.py into <project >/main/apps/<app>/actors/<actor.py>
    
    - actor.py
        
        ```python
        """
        actor
        """
        from django.http import HttpResponse
        from main.utils.logger import log_trigger, log_writer
        
        @log_trigger("INFO")
        def <actor function>(request):
            """
            test function
            """
            log_writer('ERROR', <actor function>, (request,), message="error message")
            return HttpResponse("test")
        ```
        
- d. creating actor test.py function
    
    copy test.py into <project >/main/apps/<app>/tests/test.py
    
    - test_actors.py
        
        modify class name and request url
        
        ```python
        """
        test api
        """
        import json
        from django.test import TestCase, Client
        
        class Test<Actor.name>(TestCase):
            """
            test actor
            """
        
            def setUp(self):
                """
                intial unit test request
                """
                self.client = Client()
        
            def test_<function.name>(self):
                """
                pass
                """
                response = self.client.post(
                    path="http://<your url include host ip>:<port>/<your api path>",
                    data=json.dumps({'test': '123', "test2": "1234"}),
                    content_type='application/json'
                )
                self.assertEqual(response.status_code, 200)
        ```
        
- e. run django test
    
    `python manage.py test`
    

# Swagger API

- Step 2. Import `drf_yasg` to `urls.py` (Module/System urls.py as you want)
    - `schema_view.with_ui`裡面只能選擇`swagger`或是`redoc`
        - swagger是看到API的主頁面
        - redoc是編輯Swagger文件的地方
    
    ```bash
    from drf_yasg.views import get_schema_view
    from drf_yasg import openapi
    
    # Swagger setting
    schema_view = get_schema_view(
        openapi.Info(
            title="AI/ML Intelligent Platform API",
            default_version='v1.0',
            description="AI/ML Intelligent Platform API",
            contact=openapi.Contact(email="antony95070@gmail.com"),
            license=openapi.License(name="BSD License"),
        ),
        public=True,
    )
    
    urlpatterns = [
    # Swagger
        path(f'{API_ROOT}/{API_VERSION}/swagger/',schema_view.with_ui('swagger'), name='schema-swagger-ui'),
        path(f'{API_ROOT}/{API_VERSION}/redoc/',schema_view.with_ui('redoc'), name='schema-redoc'),
    ]
    ```
    
- Step 3. Test API
    
    !Untitled
    

# Requests

- Jsondata
    - Step 1. requests
        
        使用request的json參數，不使用data參數(因為json格式已經轉換好)
        
        ```python
        response = requests.post(
                        url='http://<host>/<module>/<actor>/<component>',
                        **json={uid_key: uid_value},
        								headers={'Content-Type': 'application/json'}**
                    )
        ```
        
    - Step 2. response
        
        使用json.loads讀取request內容，要加decode utf-8
        
        ```python
        data = **json.loads**(request.body.**decode('utf-8')**)
        ```
        
- File
    - Step 1. requests
        
        使用request的json參數，不使用data參數(因為json格式已經轉換好)
        
        *header參數命名規則要留意: 首字一定是大寫、不能有「_」，會直接判定無效header
        
        ```python
        response = requests.post(
                        url='http://<host>/<module>/<actor>/<component>',
                        **header={Uid: <UID Value>},
        								files= <File>'**
                    )
        ```
        
    - Step 2. response
        
        使用request.headers.get(’Uid’)去取得某個在Http Header內的Uid屬性
        
        使用request.FILES去取得Http Files的所有檔案，並用<prefix_name>去抓取特定檔案的名稱
        
        ```python
        uid = request.headers.get('Uid')
        files = request.FILES
        file = files[f'{prefix_name}_file']
        ```
        
    

# FAQ

- Clear Migration data
    
    ```python
    find . -path "*/migrations/*.py" -not -name "__init__.py" -delete
    find . -path "*/migrations/*.pyc"  -delete
    python manage.py makemigrations
    python manage.py migrate
    ```
    
- <app_name>/urls.py example
    
    ```python
    from django.urls import path, include
    from .views import *
    
    urlpatterns = [
        path('', include('django_atlassian.urls'))
    ]
    ```
    
- delete _pycache_ folder under the project
    
    ```bash
    cd <your project folder>
    find . | grep -E "(__pycache__|\.pyc|\.pyo)$" | xargs rm -rf
    ```