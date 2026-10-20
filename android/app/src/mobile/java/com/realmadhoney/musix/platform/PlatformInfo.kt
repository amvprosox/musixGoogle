package com.realmadhoney.musix.platform

import android.content.Context
import android.content.Intent
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import com.realmadhoney.musix.ui.MainActivity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

@OptIn(UnstableApi::class)
object PlatformInfo {
    const val IS_CAR = false

    fun sessionActivity(context: Context): Intent =
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

    fun signInActivity(context: Context): Intent =
        Intent(context, MainActivity::class.java)
            .setAction(MainActivity.ACTION_SIGN_IN)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

    fun drivingRestrictions(context: Context): DrivingRestrictions = Unrestricted

    private object Unrestricted : DrivingRestrictions {
        private val flow = MutableStateFlow(false)
        override val restricted: StateFlow<Boolean> = flow.asStateFlow()

        override fun release() = Unit
    }
}
