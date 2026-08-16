UPDATE public.app_release SET
  android_download_url = 'https://github.com/frenzeldarzadon-code/wavewallet-android-releases/releases/latest/download/WaveWallet-v1.0.0.apk',
  updated_at = now()
WHERE id = 1;