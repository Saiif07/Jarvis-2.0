package com.sannabot.native

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothHeadset
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * BluetoothModule – Monitor Bluetooth audio device connections
 *
 * Emits events:
 *   - bluetooth_audio_connected: { deviceName: String, deviceAddress: String }
 *   - bluetooth_audio_disconnected: { deviceName: String, deviceAddress: String }
 */
class BluetoothModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "BluetoothModule"
    }

    private val bluetoothAdapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
    private val audioManager: AudioManager
        get() = reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    private var bluetoothHeadsetProfile: BluetoothHeadset? = null
    private var profileProxy: BluetoothProfile.ServiceListener? = null
    private var broadcastReceiver: BroadcastReceiver? = null

    override fun getName(): String = "BluetoothModule"

    // Required by NativeEventEmitter on Android
    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    /**
     * Get current Bluetooth audio device status.
     * Returns: { connected: Boolean, deviceName?: String, deviceAddress?: String }
     */
    @ReactMethod
    fun getBluetoothAudioStatus(promise: Promise) {
        try {
            if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled) {
                val result = WritableNativeMap()
                result.putBoolean("connected", false)
                promise.resolve(result)
                return
            }

            // Check if audio is routed to Bluetooth
            val isBluetoothAudioOn = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                audioManager.isBluetoothScoOn
            } else {
                @Suppress("DEPRECATION")
                audioManager.isBluetoothScoOn
            }

            if (!isBluetoothAudioOn) {
                val result = WritableNativeMap()
                result.putBoolean("connected", false)
                promise.resolve(result)
                return
            }

            // Get connected Bluetooth audio device
            val connectedDevice = getConnectedBluetoothAudioDevice()
            val result = WritableNativeMap()
            if (connectedDevice != null) {
                result.putBoolean("connected", true)
                result.putString("deviceName", connectedDevice.name ?: "Unknown")
                result.putString("deviceAddress", connectedDevice.address)
            } else {
                result.putBoolean("connected", false)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting Bluetooth audio status", e)
            promise.reject("BLUETOOTH_ERROR", e.message ?: "Unknown error", e)
        }
    }

    /**
     * Start monitoring Bluetooth audio device connections.
     */
    @ReactMethod
    fun startMonitoring(promise: Promise) {
        try {
            if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled) {
                promise.resolve("Bluetooth not available or disabled")
                return
            }

            // Register BroadcastReceiver for Bluetooth connection events
            if (broadcastReceiver == null) {
                broadcastReceiver = object : BroadcastReceiver() {
                    override fun onReceive(context: Context, intent: Intent) {
                        when (intent.action) {
                            BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED -> {
                                val state = intent.getIntExtra(BluetoothHeadset.EXTRA_STATE, BluetoothHeadset.STATE_DISCONNECTED)
                                val device = intent.getParcelableExtra<BluetoothDevice>(BluetoothDevice.EXTRA_DEVICE)
                                
                                if (device != null) {
                                    when (state) {
                                        BluetoothHeadset.STATE_CONNECTED -> {
                                            Log.d(TAG, "Bluetooth audio device connected: ${device.name} (${device.address})")
                                            lastKnownDevice = device
                                            sendEvent("bluetooth_audio_connected", Arguments.createMap().apply {
                                                putString("deviceName", device.name ?: "Unknown")
                                                putString("deviceAddress", device.address)
                                            })
                                        }
                                        BluetoothHeadset.STATE_DISCONNECTED -> {
                                            Log.d(TAG, "Bluetooth audio device disconnected: ${device.name} (${device.address})")
                                            if (lastKnownDevice?.address == device.address) {
                                                lastKnownDevice = null
                                            }
                                            sendEvent("bluetooth_audio_disconnected", Arguments.createMap().apply {
                                                putString("deviceName", device.name ?: "Unknown")
                                                putString("deviceAddress", device.address)
                                            })
                                        }
                                    }
                                }
                            }
                            AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED -> {
                                val state = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, AudioManager.SCO_AUDIO_STATE_DISCONNECTED)
                                when (state) {
                                    AudioManager.SCO_AUDIO_STATE_CONNECTED -> {
                                        // SCO audio connected - check for device
                                        val device = getConnectedBluetoothAudioDevice()
                                        if (device != null) {
                                            Log.d(TAG, "Bluetooth SCO audio connected: ${device.name} (${device.address})")
                                            lastKnownDevice = device
                                            sendEvent("bluetooth_audio_connected", Arguments.createMap().apply {
                                                putString("deviceName", device.name ?: "Unknown")
                                                putString("deviceAddress", device.address)
                                            })
                                        }
                                    }
                                    AudioManager.SCO_AUDIO_STATE_DISCONNECTED -> {
                                        // SCO audio disconnected
                                        val device = lastKnownDevice
                                        if (device != null) {
                                            Log.d(TAG, "Bluetooth SCO audio disconnected: ${device.name} (${device.address})")
                                            sendEvent("bluetooth_audio_disconnected", Arguments.createMap().apply {
                                                putString("deviceName", device.name ?: "Unknown")
                                                putString("deviceAddress", device.address)
                                            })
                                            lastKnownDevice = null
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                val filter = IntentFilter().apply {
                    addAction(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED)
                    addAction(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED)
                }
                reactApplicationContext.registerReceiver(broadcastReceiver, filter)
            }

            // Connect to BluetoothHeadset profile to get device info
            if (profileProxy == null) {
                profileProxy = object : BluetoothProfile.ServiceListener {
                    override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
                        if (profile == BluetoothProfile.HEADSET) {
                            bluetoothHeadsetProfile = proxy as BluetoothHeadset
                            Log.d(TAG, "BluetoothHeadset profile connected")
                        }
                    }

                    override fun onServiceDisconnected(profile: Int) {
                        if (profile == BluetoothProfile.HEADSET) {
                            bluetoothHeadsetProfile = null
                            Log.d(TAG, "BluetoothHeadset profile disconnected")
                        }
                    }
                }
                bluetoothAdapter.getProfileProxy(reactApplicationContext, profileProxy, BluetoothProfile.HEADSET)
            }

            promise.resolve("Monitoring started")
        } catch (e: Exception) {
            Log.e(TAG, "Error starting Bluetooth monitoring", e)
            promise.reject("BLUETOOTH_ERROR", e.message ?: "Unknown error", e)
        }
    }

    /**
     * Stop monitoring Bluetooth audio device connections.
     */
    @ReactMethod
    fun stopMonitoring(promise: Promise) {
        try {
            broadcastReceiver?.let {
                reactApplicationContext.unregisterReceiver(it)
                broadcastReceiver = null
            }

            bluetoothHeadsetProfile?.let {
                bluetoothAdapter?.closeProfileProxy(BluetoothProfile.HEADSET, it)
                bluetoothHeadsetProfile = null
            }
            profileProxy = null

            promise.resolve("Monitoring stopped")
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping Bluetooth monitoring", e)
            promise.reject("BLUETOOTH_ERROR", e.message ?: "Unknown error", e)
        }
    }

    private fun getConnectedBluetoothAudioDevice(): BluetoothDevice? {
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled) {
            return null
        }

        // Check via AudioManager SCO state
        val isBluetoothScoOn = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            audioManager.isBluetoothScoOn
        } else {
            @Suppress("DEPRECATION")
            audioManager.isBluetoothScoOn
        }

        if (!isBluetoothScoOn) {
            return null
        }

        // Try to get device from BluetoothHeadset profile
        bluetoothHeadsetProfile?.let { headset ->
            val connectedDevices = headset.connectedDevices
            if (connectedDevices.isNotEmpty()) {
                return connectedDevices[0]
            }
        }

        // Fallback: check bonded devices for audio-capable devices
        val bondedDevices = bluetoothAdapter.bondedDevices
        for (device in bondedDevices) {
            val deviceClass = device.bluetoothClass
            if (deviceClass != null) {
                val deviceClassValue = deviceClass.majorDeviceClass
                // Check if it's an audio device (headset, speaker, etc.)
                if (deviceClassValue == BluetoothClass.Device.Major.AUDIO_VIDEO) {
                    return device
                }
            }
        }

        return null
    }

    private var lastKnownDevice: BluetoothDevice? = null

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        try {
            broadcastReceiver?.let {
                reactApplicationContext.unregisterReceiver(it)
            }
            bluetoothHeadsetProfile?.let {
                bluetoothAdapter?.closeProfileProxy(BluetoothProfile.HEADSET, it)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error cleaning up Bluetooth module", e)
        }
    }
}
