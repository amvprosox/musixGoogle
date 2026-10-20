package com.realmadhoney.musix.platform

import android.car.Car
import android.car.drivingstate.CarUxRestrictions
import android.car.drivingstate.CarUxRestrictionsManager
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import com.realmadhoney.musix.car.CarSettingsActivity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

@OptIn(UnstableApi::class)
object PlatformInfo {
    const val IS_CAR = true

    fun sessionActivity(context: Context): Intent =
        Intent(context, CarSettingsActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

    fun signInActivity(context: Context): Intent =
        Intent(context, CarSettingsActivity::class.java)
            .setAction(CarSettingsActivity.ACTION_SIGN_IN)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

    fun drivingRestrictions(context: Context): DrivingRestrictions = CarRestrictions(context)

    private class CarRestrictions(
        context: Context,
    ) : DrivingRestrictions {
        private val flow = MutableStateFlow(true)
        override val restricted: StateFlow<Boolean> = flow.asStateFlow()
        private var car: Car? = null
        private var manager: CarUxRestrictionsManager? = null

        init {
            val connected =
                try {
                    Car.createCar(context)
                } catch (error: IllegalStateException) {
                    Log.w(TAG, "Car service unavailable", error)
                    null
                } catch (error: SecurityException) {
                    Log.w(TAG, "Car service refused the connection", error)
                    null
                }
            car = connected
            val restrictionsManager = connected?.getCarManager(Car.CAR_UX_RESTRICTION_SERVICE) as? CarUxRestrictionsManager
            manager = restrictionsManager
            if (restrictionsManager == null) {
                flow.value = false
            } else {
                apply(restrictionsManager.currentCarUxRestrictions)
                restrictionsManager.registerListener { apply(it) }
            }
        }

        private fun apply(restrictions: CarUxRestrictions?) {
            flow.value = restrictions?.isRequiresDistractionOptimization ?: false
        }

        override fun release() {
            manager?.unregisterListener()
            manager = null
            car?.disconnect()
            car = null
        }

        private companion object {
            const val TAG = "MusixCar"
        }
    }
}
