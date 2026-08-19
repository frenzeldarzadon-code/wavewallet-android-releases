update public.app_release set
  android_enabled = true,
  android_download_url = 'https://github.com/frenzeldarzadon-code/wavewallet-android-releases/releases/download/v1.1.1/WaveWallet-1.1.1.apk',
  android_version = '1.1.1',
  android_release_date = '2026-08-19'::date,
  android_size_bytes = 2795710,
  android_min_os = 'Android 7.0+',
  android_sha256 = '4af79779ce316190b3afd4c796d87bd542c358d8d8b6966c5a4853c75f7f284d',
  android_release_notes = 'Voucher images now save reliably to Downloads inside the Android app, and WaveWallet can check for web and app updates from Profile.',
  updated_at = now()
where id = 1;