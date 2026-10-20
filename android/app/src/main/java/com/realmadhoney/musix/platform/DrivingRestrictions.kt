package com.realmadhoney.musix.platform

import kotlinx.coroutines.flow.StateFlow

interface DrivingRestrictions {
    val restricted: StateFlow<Boolean>

    fun release()
}
