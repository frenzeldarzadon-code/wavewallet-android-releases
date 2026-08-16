UPDATE public.app_release SET
  android_enabled = true,
  android_download_url = 'https://github.com/frenzeldarzadon-code/sagada-wave-wallet/releases/latest/download/app-release.apk',
  android_version = '1.0.0',
  android_release_date = '2026-08-16',
  android_size_bytes = 2789212,
  android_min_os = 'Android 7.0+',
  android_release_notes = 'First official WaveWallet Android release. Same account, same shops, same Coins as the website.',
  updated_at = now()
WHERE id = 1;