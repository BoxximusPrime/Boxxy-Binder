/**
 * Star Citizen Axis Mapping Utilities
 * 
 * Star Citizen uses specific axis names (x, y, z, rotx, roty, rotz, slider1, slider2)
 * instead of generic axis numbers. This module handles the mapping between
 * physical joystick axes and Star Citizen axis names.
 */

// Default mapping from physical axis numbers to Star Citizen axis names
// Based on common joystick conventions (DirectInput standard)
// NOTE: This is a FALLBACK only - actual mappings should come from HID descriptors
const DEFAULT_AXIS_MAPPING = {
    1: 'x',       // Usually horizontal stick movement
    2: 'y',       // Usually vertical stick movement  
    3: 'z',       // Usually throttle or twist
    4: 'rotx',    // Usually rotation around X axis
    5: 'roty',    // Usually rotation around Y axis
    6: 'rotz',    // Usually rotation around Z axis (twist)
    7: 'slider1', // Usually slider 1
    8: 'slider2'  // Usually slider 2
};

// Mapping from HID usage names to Star Citizen axis names
const HID_TO_SC_AXIS_MAP = {
    'X': 'x',
    'Y': 'y',
    'Z': 'z',
    'Rx': 'rotx',
    'Ry': 'roty',
    'Rz': 'rotz',
    'RotationX': 'rotx',
    'RotationY': 'roty',
    'RotationZ': 'rotz',
    'Slider': 'slider1',
    'Dial': 'slider2',
    'Wheel': 'slider2'
};

// Valid Star Citizen axis names
const SC_AXIS_NAMES = ['x', 'y', 'z', 'rotx', 'roty', 'rotz', 'slider1', 'slider2'];

/**
 * Build a device-specific axis mapping from HID descriptor data
 * Converts DirectInput axis indices to Star Citizen axis names using actual HID data
 * @param {Object} directInputToHidMap - Map of DirectInput index -> HID usage ID
 * @param {Object} hidAxisNames - Map of HID usage ID -> HID axis name (e.g., "X", "Rz")
 * @returns {Object} - Axis mapping (DirectInput index -> SC axis name)
 */
export function buildAxisMappingFromHID(directInputToHidMap, hidAxisNames)
{
    const mapping = {};

    for (const [directInputIndex, hidUsageId] of Object.entries(directInputToHidMap))
    {
        const hidAxisName = hidAxisNames[hidUsageId];
        if (hidAxisName)
        {
            // Convert HID name to SC axis name
            const scAxisName = HID_TO_SC_AXIS_MAP[hidAxisName] || `axis${directInputIndex}`;
            mapping[parseInt(directInputIndex)] = scAxisName;

            console.log(`[Axis Mapping] DirectInput ${directInputIndex} -> HID "${hidAxisName}" -> SC "${scAxisName}"`);
        }
    }

    return mapping;
}

/**
 * Get the default Star Citizen axis name for a physical axis number
 * @param {number} axisNumber - Physical axis number (1-8)
 * @returns {string} - Star Citizen axis name
 */
export function getDefaultSCAxisName(axisNumber)
{
    return DEFAULT_AXIS_MAPPING[axisNumber] || `axis${axisNumber}`;
}

/**
 * Convert a detected input string to Star Citizen format
 * Converts: "js1_axis3_positive" -> "js1_z"
 * Converts: "js2_axis6_negative" -> "js2_rotz"
 * @param {string} inputString - Input string like "js1_axis3_positive"
 * @param {Object} customMapping - Optional custom axis mapping (overrides defaults)
 * @returns {string} - Star Citizen format like "js1_z"
 */
export function convertToSCAxisFormat(inputString, customMapping = null)
{
    if (!inputString || !inputString.includes('_axis')) return inputString;

    // Extract device prefix, instance number, and axis number
    const match = inputString.match(/(js|gp)(\d+)_axis(\d+)(?:_(positive|negative))?/);
    if (!match) return inputString;

    const devicePrefix = match[1];
    const instanceNumber = match[2];
    const axisNumber = parseInt(match[3]);
    const direction = match[4]; // positive or negative

    // Get the SC axis name (from custom mapping or defaults)
    const mapping = customMapping || DEFAULT_AXIS_MAPPING;
    const scAxisName = mapping[axisNumber] || `axis${axisNumber}`;

    // Star Citizen format doesn't include direction - that's handled by inversion
    return `${devicePrefix}${instanceNumber}_${scAxisName}`;
}

/**
 * Check if an axis should be inverted based on direction
 * @param {string} inputString - Input string like "js1_axis3_negative"
 * @returns {boolean} - True if axis should be inverted
 */
export function shouldInvertAxis(inputString)
{
    if (!inputString || !inputString.includes('_axis')) return false;
    return inputString.includes('_negative');
}

/**
 * Get axis mapping for a specific joystick (from localStorage or defaults)
 * @param {number} joystickInstance - Joystick instance number (1-based)
 * @returns {Object} - Axis mapping object
 */
export function getAxisMapping(joystickInstance)
{
    const stored = localStorage.getItem(`axisMapping_js${joystickInstance}`);
    if (stored)
    {
        try
        {
            return JSON.parse(stored);
        } catch (e)
        {
            console.error('Failed to parse stored axis mapping:', e);
        }
    }
    return { ...DEFAULT_AXIS_MAPPING };
}

/**
 * Save axis mapping for a specific joystick
 * @param {number} joystickInstance - Joystick instance number (1-based)
 * @param {Object} mapping - Axis mapping object
 */
export function saveAxisMapping(joystickInstance, mapping)
{
    localStorage.setItem(`axisMapping_js${joystickInstance}`, JSON.stringify(mapping));
}

/**
 * Get a human-friendly description of an SC axis name
 * @param {string} scAxisName - SC axis name like "x", "rotz", "slider1"
 * @returns {string} - Description
 */
export function getSCAxisDescription(scAxisName)
{
    const descriptions = {
        'x': 'X-Axis (Horizontal)',
        'y': 'Y-Axis (Vertical)',
        'z': 'Z-Axis (Throttle/Depth)',
        'rotx': 'Rotation X (Pitch)',
        'roty': 'Rotation Y (Roll)',
        'rotz': 'Rotation Z (Yaw/Twist)',
        'slider1': 'Slider 1',
        'slider2': 'Slider 2'
    };
    return descriptions[scAxisName] || scAxisName;
}

/**
 * Parse an SC axis input string to get components
 * @param {string} scInput - SC format like "js2_rotz"
 * @returns {Object|null} - {instance, axisName} or null
 */
export function parseSCAxisInput(scInput)
{
    if (!scInput) return null;

    const match = scInput.match(/js(\d+)_(x|y|z|rotx|roty|rotz|slider1|slider2)/);
    if (!match) return null;

    return {
        instance: parseInt(match[1]),
        axisName: match[2]
    };
}

/**
 * Get all valid SC axis names
 * @returns {Array<string>} - Array of valid axis names
 */
export function getValidSCAxisNames()
{
    return [...SC_AXIS_NAMES];
}
