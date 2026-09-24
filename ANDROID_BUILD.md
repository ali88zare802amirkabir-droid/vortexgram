# VORTEXGRAM Android Build Instructions

## راه‌اندازی

### ۱. Android Studio را نصب کنید
https://developer.android.com/studio

### ۲. پروژه را باز کنید
- Android Studio → Open → پوشه `D:\fake-telegram\android`

### ۳. SDK را تنظیم کنید
- File → Project Structure → SDK Location
- مسیر SDK را تنظیم کنید (معمولاً `C:\Users\<username>\AppData\Local\Android\Sdk`)

### ۴. Build کنید
- Build → Build Bundle(s) / APK(s) → Build APK(s)
- یا از ترمینال:
```bash
cd D:\fake-telegram\android
.\gradlew.bat assembleDebug
```

### ۵. APK را پیدا کنید
- `D:\fake-telegram\android\app\build\outputs\apk\debug\app-debug.apk`

## تنظیمات سرور

برای تغییر آدرس سرور، فایل زیر را ویرایش کنید:
```
D:\fake-telegram\capacitor.config.json
```
و مقدار `server.url` را تغییر دهید.

بعد از تغییر:
```bash
cd D:\fake-telegram
npx cap sync android
```

## ساخت Release APK

### امضا کردن APK
1. کلید store بسازید:
```bash
keytool -genkey -v -keystore vortexgram.keystore -alias vortexgram -keyalg RSA -keysize 2048 -validity 10000
```

2. در `android/app/build.gradle` اضافه کنید:
```gradle
android {
    signingConfigs {
        release {
            storeFile file('vortexgram.keystore')
            storePassword 'YOUR_PASSWORD'
            keyAlias 'vortexgram'
            keyPassword 'YOUR_PASSWORD'
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
```

3. بسازید:
```bash
.\gradlew.bat assembleRelease
```

## مجوزهای اندروید
- `INTERNET` - اتصال به سرور
- `RECORD_AUDIO` - ضبط صدا
- `VIBRATE` - بازخورد لمسی
- `ACCESS_NETWORK_STATE` - بررسی اتصال
- `WAKE_LOCK` - جلوگیری از خاموش شدن صفحه

## نکات
- اپ از آدرس سرور (tunnel URL) لود می‌شود
- برای استفاده offline، باید فایل‌های public را bundled کنید
- نسخه فعلی: v=99
