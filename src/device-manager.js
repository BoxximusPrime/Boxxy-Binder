const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
import { getInputType } from './input-utils.js';

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

// Maps device UUID to prefix (e.g., { "uuid-123": "js1" })
let devicePrefixMapping = {};

// Cache key for localStorage
const DEVICE_PREFIX_CACHE_KEY = 'devicePrefixMapping';
const DEVICE_UUID_CACHE_KEY = 'deviceUuidMapping'; // Maps device identifiers to their UUIDs
const MAX_JOYSTICKS_KEY = 'maxJoystickInputs';
const MAX_GAMEPADS_KEY = 'maxGamepadInputs';

// ============================================================================
// DEVICE LIMITS CONFIGURATION
// ============================================================================

/**
 * Get the maximum number of joystick inputs from settings
 * @returns {number} Max joystick count (default 4)
 */
export function getMaxJoysticks()
{
    const saved = localStorage.getItem(MAX_JOYSTICKS_KEY);
    return saved ? parseInt(saved, 10) : 4;
}

/**
 * Get the maximum number of gamepad inputs from settings
 * @returns {number} Max gamepad count (default 4)
 */
export function getMaxGamepads()
{
    const saved = localStorage.getItem(MAX_GAMEPADS_KEY);
    return saved ? parseInt(saved, 10) : 4;
}

/**
 * Set the maximum number of joystick inputs
 * @param {number} count 
 */
export function setMaxJoysticks(count)
{
    localStorage.setItem(MAX_JOYSTICKS_KEY, count.toString());
    console.log(`[DEVICE-MANAGER] Max joysticks set to ${count}`);
}

/**
 * Set the maximum number of gamepad inputs
 * @param {number} count 
 */
export function setMaxGamepads(count)
{
    localStorage.setItem(MAX_GAMEPADS_KEY, count.toString());
    console.log(`[DEVICE-MANAGER] Max gamepads set to ${count}`);
}

/**
 * Generate HTML options for joystick prefixes
 * @param {string} savedPrefix - Currently saved prefix to mark as selected
 * @returns {string} HTML options string
 */
export function generateJoystickPrefixOptions(savedPrefix)
{
    const maxJs = getMaxJoysticks();
    const maxGp = getMaxGamepads();
    let options = `<option value="" ${savedPrefix === '' ? 'selected' : ''}>Use Default</option>\n`;

    for (let i = 1; i <= maxJs; i++)
    {
        const value = `js${i}`;
        options += `<option value="${value}" ${savedPrefix === value ? 'selected' : ''}>${value}</option>\n`;
    }

    for (let i = 1; i <= maxGp; i++)
    {
        const value = `gp${i}`;
        options += `<option value="${value}" ${savedPrefix === value ? 'selected' : ''}>${value}</option>\n`;
    }

    return options;
}

// Make functions available globally for other modules
window.getMaxJoysticks = getMaxJoysticks;
window.getMaxGamepads = getMaxGamepads;
window.setMaxJoysticks = setMaxJoysticks;
window.setMaxGamepads = setMaxGamepads;
window.generateJoystickPrefixOptions = generateJoystickPrefixOptions;

// Input debugging state
let isDebuggerActive = false;
let debuggerDetectionLoop = null;
let eventCount = 0;
let uniqueButtons = new Set();
let uniqueAxes = new Set();
let uniqueHats = new Set();
let uniqueKeys = new Set();
let lastAxisInput = null;

// DOM References
let deviceListContainer = null;
let mappingSection = null;
let debuggerSection = null;
let debuggerTimeline = null;
let debuggerControls = null;

// ============================================================================
// INITIALIZATION
// ============================================================================

// Load prefix mappings early (called on app startup)
window.loadDevicePrefixMappings = function ()
{
    console.log('[DEVICE-MANAGER] Early loading of device prefix mappings...');
    loadPrefixMappings();
};

window.initializeDeviceManager = async function ()
{
    console.log('[DEVICE-MANAGER] Initializing...');

    // Get DOM references
    deviceListContainer = document.getElementById('dm-device-list');
    mappingSection = document.getElementById('dm-mapping-section');
    debuggerSection = document.getElementById('dm-debugger-section');
    debuggerTimeline = document.getElementById('dm-debugger-timeline');

    // Set up event listeners
    setupEventListeners();

    // Load saved prefix mappings (may already be loaded from early init)
    loadPrefixMappings();

    // Load connected devices
    await refreshDeviceList();

    console.log('[DEVICE-MANAGER] Initialization complete');
};

function setupEventListeners()
{
    // Debugger controls
    document.getElementById('dm-start-debug-btn')?.addEventListener('click', startInputDebugger);
    document.getElementById('dm-stop-debug-btn')?.addEventListener('click', stopInputDebugger);
    document.getElementById('dm-clear-debug-btn')?.addEventListener('click', clearDebuggerLog);
    document.getElementById('dm-refresh-devices-btn')?.addEventListener('click', refreshDeviceList);

    // Keyboard event listener for debugging
    document.addEventListener('keydown', handleKeyboardInput, true);
}

// ============================================================================
// DEVICE LIST DISPLAY
// ============================================================================

async function refreshDeviceList()
{
    try
    {
        const devices = await invoke('detect_joysticks');
        console.log('[DEVICE-MANAGER] Detected devices:', devices);

        deviceListContainer.innerHTML = '';

        if (!devices || devices.length === 0)
        {
            deviceListContainer.innerHTML = `
        <div class="dm-empty-state">
          <div class="dm-empty-icon">🎮</div>
          <p>No devices detected</p>
          <p class="dm-empty-hint">Connect a joystick or gamepad and click refresh</p>
        </div>
      `;
            return;
        }

        // Count joysticks and gamepads separately for proper auto-ID assignment
        let joystickCount = 0;
        let gamepadCount = 0;

        devices.forEach((device) =>
        {
            const isGp = device.device_type === 'Gamepad';
            const categoryIndex = isGp ? ++gamepadCount : ++joystickCount;
            const deviceCard = createDeviceCard(device, categoryIndex, isGp);
            deviceListContainer.appendChild(deviceCard);
        });

    } catch (error)
    {
        console.error('[DEVICE-MANAGER] Error fetching devices:', error);
        deviceListContainer.innerHTML = `
      <div class="dm-error-state">
        <p>Error loading devices: ${error}</p>
      </div>
    `;
    }
}

function createDeviceCard(device, categoryIndex, isGp)
{
    const card = document.createElement('div');
    card.className = 'dm-device-card';

    const typeClass = isGp ? 'gamepad' : 'joystick';
    const autoDetectedId = isGp ? `gp${categoryIndex}` : `js${categoryIndex}`;
    const statusClass = device.is_connected ? 'connected' : 'disconnected';
    const deviceEmoji = isGp ? '🎮' : '🕹️';

    // Use device UUID if available, otherwise create a stable identifier
    const deviceUuid = device.uuid || generateDeviceIdentifier(device);

    // Get saved prefix for this device
    const savedPrefix = devicePrefixMapping[deviceUuid] || '';

    console.log(`[DEVICE-MANAGER] Device card created:`, {
        name: device.name,
        uuid: deviceUuid,
        autoDetectedId: autoDetectedId,
        savedPrefix: savedPrefix || '(using default)'
    });

    card.innerHTML = `
    <div class="dm-device-header">
      <div class="dm-device-icon ${typeClass}">${deviceEmoji}</div>
      <div class="dm-device-info">
        <div class="dm-device-name">${device.name}</div>
        <div class="dm-device-type">${device.device_type} • UUID: <code>${deviceUuid}</code></div>
      </div>
      <div class="dm-device-badge ${statusClass}">${device.is_connected ? '✓ Connected' : '✗ Disconnected'}</div>
    </div>
    <div class="dm-device-body">
      ${savedPrefix ? `
      <div class="dm-assignment-row">
        <div class="dm-device-assigned">
          <span class="dm-detail-label">Auto-Detected ID:</span>
          <code class="dm-detail-value dm-auto-detected-id">${autoDetectedId}</code>
        </div>
        <div class="dm-device-detail dm-device-mapped">
          <span class="dm-detail-label">Current Assignment:</span>
          <code class="dm-detail-value dm-mapped-id">${autoDetectedId}</code>
          <span class="dm-mapping-arrow">→</span>
          <code class="dm-detail-value dm-override-id">${savedPrefix}</code>
        </div>
      </div>
      <div class="dm-device-detail">
        <span class="dm-detail-label">Assigned Prefix:</span>
        <div class="dm-prefix-wrapper">
          <select class="dm-prefix-select" data-device-uuid="${deviceUuid}" data-device-name="${device.name}">
            ${generateJoystickPrefixOptions(savedPrefix)}
          </select>
          <div class="dm-prefix-badge dm-override-badge">OVERRIDE</div>
        </div>
      </div>
      ` : `
      <div class="dm-device-assigned">
        <span class="dm-detail-label">Auto-Detected ID:</span>
        <code class="dm-detail-value dm-auto-detected-id">${autoDetectedId}</code>
      </div>
      <div class="dm-device-detail">
        <span class="dm-detail-label">Assigned Prefix:</span>
        <div class="dm-prefix-wrapper">
          <select class="dm-prefix-select" data-device-uuid="${deviceUuid}" data-device-name="${device.name}">
            ${generateJoystickPrefixOptions(savedPrefix)}
          </select>
          <div class="dm-prefix-badge dm-default-badge">DEFAULT</div>
        </div>
      </div>
      `}
    </div>
  `;

    // Add event listener for prefix change
    setTimeout(() =>
    {
        const select = card.querySelector('.dm-prefix-select');
        if (select)
        {
            select.addEventListener('change', (e) =>
            {
                handlePrefixChange(deviceUuid, e.target.value, device.name, autoDetectedId);
            });
        }
    }, 0);

    return card;
}

function handlePrefixChange(deviceUuid, prefix, deviceName, autoDetectedId)
{
    if (!prefix)
    {
        // Clear mapping - use auto-detected ID
        const wasOverridden = !!devicePrefixMapping[deviceUuid];
        delete devicePrefixMapping[deviceUuid];
        console.log(`[DEVICE-MANAGER] ✓ Cleared prefix for "${deviceName}" (${deviceUuid})`);
        if (wasOverridden)
        {
            console.log(`[DEVICE-MANAGER]   → Will use auto-detected ID: ${autoDetectedId}`);
        }
    } else
    {
        // Set prefix mapping
        const previousPrefix = devicePrefixMapping[deviceUuid];
        devicePrefixMapping[deviceUuid] = prefix;
        console.log(`[DEVICE-MANAGER] ✓ Updated prefix for "${deviceName}" (${deviceUuid})`);
        console.log(`[DEVICE-MANAGER]   UUID: ${deviceUuid}`);
        console.log(`[DEVICE-MANAGER]   Auto-detected: ${autoDetectedId}`);
        console.log(`[DEVICE-MANAGER]   Override: ${prefix}${previousPrefix ? ` (was: ${previousPrefix})` : ''}`);
    }

    // Auto-save mappings
    savePrefixMappings();

    // Refresh UI to show updated mapping
    refreshDeviceList();
}

// ============================================================================
// DEVICE MAPPING (SC ID OVERRIDE)
// ============================================================================

/**
 * Generates a stable device identifier from device properties
 * Uses: vendor_id + product_id + serial_number (if available) + device name
 * This ensures the same physical device gets the same ID across sessions
 */
function generateDeviceIdentifier(device)
{
    // Try to use hardware identifiers first
    if (device.vendor_id && device.product_id)
    {
        const serial = device.serial_number || 'nosn';
        const id = `${device.vendor_id}-${device.product_id}-${serial}`;
        console.log(`[DEVICE-MANAGER] Generated hardware ID: ${id}`);
        return id;
    }

    // Fallback to device name hash if no hardware IDs available
    const nameHash = hashString(device.name);
    const id = `name-${nameHash}`;
    console.log(`[DEVICE-MANAGER] Generated name-based ID: ${id} (from "${device.name}")`);
    return id;
}

/**
 * Simple string hash function for device names
 */
function hashString(str)
{
    let hash = 0;
    for (let i = 0; i < str.length; i++)
    {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
}

function loadPrefixMappings()
{
    try
    {
        const saved = localStorage.getItem(DEVICE_PREFIX_CACHE_KEY);
        if (saved)
        {
            devicePrefixMapping = JSON.parse(saved);
            const mappingCount = Object.keys(devicePrefixMapping).length;
            console.log(`[DEVICE-MANAGER] ✓ Loaded ${mappingCount} device prefix mappings from cache:`, devicePrefixMapping);
        } else
        {
            console.log('[DEVICE-MANAGER] No saved prefix mappings found, starting fresh');
            devicePrefixMapping = {};
        }
    }
    catch (e)
    {
        console.error('[DEVICE-MANAGER] ✗ Failed to parse saved prefix mapping:', e);
        console.warn('[DEVICE-MANAGER] Resetting to empty prefix mapping');
        devicePrefixMapping = {};
    }
}

function savePrefixMappings()
{
    try
    {
        const json = JSON.stringify(devicePrefixMapping);
        localStorage.setItem(DEVICE_PREFIX_CACHE_KEY, json);
        const mappingCount = Object.keys(devicePrefixMapping).length;
        console.log(`[DEVICE-MANAGER] ✓ Saved ${mappingCount} device prefix mappings to cache`);
        console.log('[DEVICE-MANAGER] Mappings:', devicePrefixMapping);
    }
    catch (e)
    {
        console.error('[DEVICE-MANAGER] ✗ Failed to save prefix mapping to localStorage:', e);
    }
}

// Export function to get device prefix for a given device UUID or auto-detected ID
window.getDevicePrefix = function (deviceUuid, autoDetectedId)
{
    if (!deviceUuid)
    {
        console.warn('[DEVICE-MANAGER] getDevicePrefix called without UUID, using auto-detected ID:', autoDetectedId);
        return autoDetectedId;
    }

    // Check if there's a custom prefix for this device
    const customPrefix = devicePrefixMapping[deviceUuid];
    if (customPrefix)
    {
        console.log(`[DEVICE-MANAGER] ✓ Using custom prefix for "${deviceUuid}": ${customPrefix}`);
        return customPrefix;
    }

    // Otherwise return the auto-detected ID
    console.log(`[DEVICE-MANAGER] Using auto-detected ID for "${deviceUuid}": ${autoDetectedId}`);
    return autoDetectedId;
};

// Export function to get all device prefix mappings
window.getDevicePrefixMappings = function ()
{
    return { ...devicePrefixMapping };
};

// Make prefix mapping function available globally for main.js
window.applyDevicePrefixOverride = function (detectedInput, deviceUuid)
{
    console.log(`[DEVICE-MANAGER] applyDevicePrefixOverride called with:`, {
        detectedInput,
        deviceUuid,
        mappingsAvailable: Object.keys(devicePrefixMapping),
        fullMappings: devicePrefixMapping
    });

    // Extract the auto-detected prefix from the input (e.g., "js1" from "js1_button3")
    const match = detectedInput.match(/^(js|gp)(\d+)_/);
    if (!match)
    {
        console.log(`[DEVICE-MANAGER] No device prefix found in input: ${detectedInput}`);
        return detectedInput;
    }

    const autoDetectedId = match[1] + match[2]; // e.g., "js1"

    if (!deviceUuid)
    {
        console.log(`[DEVICE-MANAGER] No deviceUuid provided, cannot apply override`);
        return detectedInput;
    }

    // Check if this device has a custom prefix mapped
    const customPrefix = devicePrefixMapping[deviceUuid];

    console.log(`[DEVICE-MANAGER] Looking for UUID "${deviceUuid}" in mappings:`, {
        found: !!customPrefix,
        customPrefix: customPrefix || 'none',
        allUuids: Object.keys(devicePrefixMapping)
    });

    if (customPrefix)
    {
        const mappedInput = detectedInput.replace(/^(js|gp)\d+_/, `${customPrefix}_`);
        console.log(`[DEVICE-MANAGER] ✓ Applied prefix override: ${detectedInput} -> ${mappedInput} (UUID: ${deviceUuid})`);
        return mappedInput;
    }

    console.log(`[DEVICE-MANAGER] No override found for UUID: ${deviceUuid}, using auto-detected: ${autoDetectedId}`);
    return detectedInput;
};

// ============================================================================
// INPUT DEBUGGER
// ============================================================================

let debuggerUnlisten = null; // Function to unlisten events

async function startInputDebugger()
{
    if (isDebuggerActive) return;

    isDebuggerActive = true;
    document.getElementById('dm-start-debug-btn').disabled = true;
    document.getElementById('dm-stop-debug-btn').disabled = false;
    document.getElementById('dm-debug-status').textContent = '🔴 Detecting...';
    document.getElementById('dm-debug-status').classList.add('detecting');

    // Clear empty message if present
    const emptyMsg = debuggerTimeline.querySelector('.dm-debug-empty');
    if (emptyMsg) emptyMsg.remove();

    // Listen for events
    if (listen)
    {
        debuggerUnlisten = await listen('input-detected', (event) =>
        {
            if (isDebuggerActive)
            {
                addDebugEvent(event.payload);
            }
        });
    }

    detectInputsLoop();
}

function stopInputDebugger()
{
    isDebuggerActive = false;
    document.getElementById('dm-start-debug-btn').disabled = false;
    document.getElementById('dm-stop-debug-btn').disabled = true;
    document.getElementById('dm-debug-status').textContent = 'Stopped';
    document.getElementById('dm-debug-status').classList.remove('detecting');

    if (debuggerDetectionLoop)
    {
        clearTimeout(debuggerDetectionLoop);
        debuggerDetectionLoop = null;
    }

    if (debuggerUnlisten)
    {
        debuggerUnlisten();
        debuggerUnlisten = null;
    }
}

function clearDebuggerLog()
{
    debuggerTimeline.innerHTML = '<div class="dm-debug-empty">Press "Start Detecting" to monitor your devices...</div>';
    eventCount = 0;
    uniqueButtons.clear();
    uniqueAxes.clear();
    uniqueHats.clear();
    uniqueKeys.clear();
    lastAxisInput = null;
    updateDebugStats();
}

async function detectInputsLoop()
{
    if (!isDebuggerActive) return;

    try
    {
        // Use the streaming command which maintains device state
        // This prevents axis detection issues caused by resetting the detector
        await invoke('wait_for_inputs_with_events', {
            sessionId: 'debugger',
            initialTimeoutSecs: 60, // Run for 60 seconds at a time
            collectDurationSecs: 60 // Keep running even after input detected
        });
    } catch (error)
    {
        console.error('[DEVICE-MANAGER] Error in detection loop:', error);
        // If error (e.g. timeout), just continue
    }

    if (isDebuggerActive)
    {
        // Loop again immediately
        debuggerDetectionLoop = setTimeout(detectInputsLoop, 10);
    }
}

function addDebugEvent(inputData)
{
    eventCount++;

    const eventType = getInputType(inputData.input_string);

    // Apply device prefix mapping to the input string
    let displayInput = inputData.input_string;
    if (inputData.device_uuid)
    {
        displayInput = window.applyDevicePrefixOverride(inputData.input_string, inputData.device_uuid);
        if (displayInput !== inputData.input_string)
        {
            console.log(`[DEVICE-MANAGER] Debugger: Applied prefix override to event: ${inputData.input_string} → ${displayInput}`);
        }
    }

    // Track the full input string (including direction) to prevent immediate duplicates
    // but allow the same axis to trigger again if direction changes or after other inputs
    if (eventType === 'axis')
    {
        // Only skip if it's the exact same axis AND direction consecutively
        if (lastAxisInput === displayInput)
        {
            return;
        }
        lastAxisInput = displayInput;
    }
    else
    {
        lastAxisInput = null;
    }

    // Track unique inputs (using the mapped input string)
    if (eventType === 'hat')
    {
        uniqueHats.add(displayInput);
    } else if (eventType === 'axis')
    {
        const baseAxis = displayInput.replace(/_(positive|negative)$/, '');
        uniqueAxes.add(baseAxis);
    } else if (eventType === 'button')
    {
        uniqueButtons.add(displayInput);
    } else if (eventType === 'keyboard')
    {
        uniqueKeys.add(displayInput);
    }

    // Create event element
    const eventEl = document.createElement('div');
    eventEl.className = `dm-debug-event ${eventType}`;

    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 });

    // Determine display type for axis
    let displayType = eventType;
    let cssClass = eventType;
    if (eventType === 'axis')
    {
        if (displayInput.includes('_positive'))
        {
            cssClass = 'axis-positive';
            displayType = 'axis +';
        } else if (displayInput.includes('_negative'))
        {
            cssClass = 'axis-negative';
            displayType = 'axis -';
        }
    }

    // Build axis value display
    let valueDisplay = '';
    if (inputData.axis_value !== undefined && inputData.axis_value !== null)
    {
        const valueClass = inputData.axis_value > 0 ? 'positive' : 'negative';
        const valuePercent = (inputData.axis_value * 100).toFixed(1);
        valueDisplay = `<div class="dm-event-value ${valueClass}">Value: ${valuePercent}%</div>`;
    }

    eventEl.innerHTML = `
    <div class="dm-event-time">${timeString}</div>
    <div class="dm-event-details">
      <div class="dm-event-input">${displayInput}</div>
      <div class="dm-event-display">${inputData.display_name}</div>
      ${valueDisplay}
    </div>
    <div class="dm-event-type ${cssClass}">${displayType}</div>
  `;

    // Insert at top
    debuggerTimeline.insertBefore(eventEl, debuggerTimeline.firstChild);

    // Auto-scroll if checkbox is checked
    const autoScroll = document.getElementById('dm-auto-scroll-checkbox');
    if (autoScroll && autoScroll.checked)
    {
        debuggerTimeline.scrollTop = 0;
    }

    // Limit to 100 events
    while (debuggerTimeline.children.length > 100)
    {
        debuggerTimeline.removeChild(debuggerTimeline.lastChild);
    }

    updateDebugStats();
}

function updateDebugStats()
{
    document.getElementById('dm-stat-total').textContent = eventCount;
    document.getElementById('dm-stat-buttons').textContent = uniqueButtons.size;
    document.getElementById('dm-stat-axes').textContent = uniqueAxes.size;
    document.getElementById('dm-stat-hats').textContent = uniqueHats.size;
    document.getElementById('dm-stat-keys').textContent = uniqueKeys.size;
}

// Keyboard event handler for debugging
function handleKeyboardInput(event)
{
    if (!isDebuggerActive) return;

    // Don't capture keyboard input if we're in an input field
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

    event.preventDefault();
    event.stopPropagation();

    const code = event.code;
    const key = event.key;

    // Convert to Star Citizen format (simplified version)
    let scKey = key.toLowerCase();
    if (code.startsWith('Key'))
    {
        scKey = code.substring(3).toLowerCase();
    } else if (code.startsWith('Digit'))
    {
        scKey = code.substring(5);
    }

    const inputString = `kb1_${scKey}`;
    const displayName = `Keyboard - ${code}`;

    addDebugEvent({
        input_string: inputString,
        display_name: displayName,
        device_type: 'Keyboard',
        axis_value: null
    });
}
