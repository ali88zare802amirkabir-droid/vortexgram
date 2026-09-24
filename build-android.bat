@echo off
echo ================================
echo   VORTEXGRAM Android Builder
echo ================================
echo.

REM Check if ANDROID_HOME is set
if "%ANDROID_HOME%"=="" (
    echo [WARN] ANDROID_HOME not set. Please install Android SDK.
    echo Download: https://developer.android.com/studio
    echo.
)

REM Navigate to android directory
cd /d "%~dp0android"

echo [1/3] Syncing Capacitor...
cd ..
call npx cap sync android
echo.

echo [2/3] Building debug APK...
cd android
call gradlew.bat assembleDebug
echo.

if exist "app\build\outputs\apk\debug\app-debug.apk" (
    echo [OK] APK built successfully!
    echo Location: android\app\build\outputs\apk\debug\app-debug.apk
    echo.
    echo To install on device:
    echo   adb install app\build\outputs\apk\debug\app-debug.apk
) else (
    echo [ERROR] Build failed. Check Android Studio / SDK installation.
)

echo.
pause
