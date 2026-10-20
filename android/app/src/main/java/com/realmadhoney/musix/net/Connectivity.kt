package com.realmadhoney.musix.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class Connectivity(
    context: Context,
) {
    private val manager = context.getSystemService(ConnectivityManager::class.java)
    private val validated = HashSet<Network>()
    private val online = MutableStateFlow(initialState())

    val isOnline: StateFlow<Boolean> = online.asStateFlow()

    private val callback =
        object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(
                network: Network,
                capabilities: NetworkCapabilities,
            ) {
                synchronized(validated) {
                    if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) &&
                        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    ) {
                        validated += network
                    } else {
                        validated -= network
                    }
                    online.value = validated.isNotEmpty()
                }
            }

            override fun onLost(network: Network) {
                synchronized(validated) {
                    validated -= network
                    online.value = validated.isNotEmpty()
                }
            }
        }

    private var registered = false

    fun start() {
        if (registered || manager == null) {
            return
        }
        val request = NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build()
        manager.registerNetworkCallback(request, callback)
        registered = true
    }

    fun stop() {
        if (!registered || manager == null) {
            return
        }
        manager.unregisterNetworkCallback(callback)
        registered = false
    }

    private fun initialState(): Boolean {
        val active = manager?.activeNetwork ?: return false
        val capabilities = manager.getNetworkCapabilities(active) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }
}
