-keep class com.wavewallet.gcashlistener.service.** { *; }
-keep class androidx.room.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**
# Never keep debug logging in release builds.
-assumenosideeffects class android.util.Log {
    public static int d(...);
    public static int v(...);
}
