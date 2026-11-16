-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes *Annotation*,InnerClasses,Signature
-dontwarn android.car.**
-keep class com.k2fsa.sherpa.onnx.** { *; }
