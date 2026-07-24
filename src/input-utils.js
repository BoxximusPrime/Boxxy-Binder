/**
 * Shared utilities for handling joystick input detection and formatting
 */

import { convertToSCAxisFormat, shouldInvertAxis, getAxisMapping } from './axis-mapping.js';

// XInput exposes Xbox controls as numbered buttons/axes, while Star Citizen's
// gamepad action-map format uses semantic names. Keep this mapping here so
// binding detection, templates, and the visual viewer all speak the same format.
const XINPUT_BUTTON_TO_SC = {
    1: 'a',
    2: 'b',
    3: 'x',
    4: 'y',
    5: 'shoulderl',
    6: 'shoulderr',
    // The current detector's legacy numbering follows its XInput mask table,
    // where button 7 is Start and button 8 is Back/View.
    7: 'start',
    8: 'back',
    9: 'thumbl',
    10: 'thumbr',
    11: 'dpad_up',
    12: 'dpad_down',
    13: 'dpad_left',
    14: 'dpad_right'
};

const XINPUT_AXIS_TO_SC = {
    1: { axis: 'thumblx', positive: 'thumbl_right', negative: 'thumbl_left' },
    2: { axis: 'thumbly', positive: 'thumbl_up', negative: 'thumbl_down' },
    3: { axis: 'thumbrx', positive: 'thumbr_right', negative: 'thumbr_left' },
    4: { axis: 'thumbry', positive: 'thumbr_up', negative: 'thumbr_down' },
    5: { axis: 'triggerl_btn', positive: 'triggerl_btn', negative: 'triggerl_btn' },
    6: { axis: 'triggerr_btn', positive: 'triggerr_btn', negative: 'triggerr_btn' }
};

// Older releases converted XInput's numbered axes with the DirectInput
// fallback. These aliases let existing Xbox templates migrate at runtime.
const LEGACY_XINPUT_AXIS_ALIAS_TO_SC = {
    z: 'thumbrx',
    rotx: 'thumbry',
    roty: 'triggerl_btn',
    rotz: 'triggerr_btn'
};

const GAMEPAD_INPUT_LABELS = {
    a: 'A',
    b: 'B',
    x: 'X',
    y: 'Y',
    shoulderl: 'Left Shoulder',
    shoulderr: 'Right Shoulder',
    back: 'View',
    start: 'Menu',
    thumbl: 'Left Stick Press',
    thumbr: 'Right Stick Press',
    dpad_up: 'D-Pad Up',
    dpad_down: 'D-Pad Down',
    dpad_left: 'D-Pad Left',
    dpad_right: 'D-Pad Right',
    thumblx: 'Left Stick X',
    thumbly: 'Left Stick Y',
    thumbrx: 'Right Stick X',
    thumbry: 'Right Stick Y',
    thumbl_up: 'Left Stick Up',
    thumbl_down: 'Left Stick Down',
    thumbl_left: 'Left Stick Left',
    thumbl_right: 'Left Stick Right',
    thumbr_up: 'Right Stick Up',
    thumbr_down: 'Right Stick Down',
    thumbr_left: 'Right Stick Left',
    thumbr_right: 'Right Stick Right',
    triggerl_btn: 'Left Trigger',
    triggerl_r_btn: 'Left Trigger Release',
    triggerr_btn: 'Right Trigger'
};

const GAMEPAD_AXIS_INPUTS = new Set(['thumblx', 'thumbly', 'thumbrx', 'thumbry']);

function normalizeGamepadInputPart(inputPart, preserveAxisDirection)
{
    const buttonMatch = inputPart.match(/^button(\d+)$/);
    if (buttonMatch)
    {
        return XINPUT_BUTTON_TO_SC[Number(buttonMatch[1])] || inputPart;
    }

    const axisMatch = inputPart.match(/^axis(\d+)(?:_(positive|negative))?$/);
    if (axisMatch)
    {
        const mapping = XINPUT_AXIS_TO_SC[Number(axisMatch[1])];
        if (!mapping) return inputPart;

        const direction = axisMatch[2];
        if (preserveAxisDirection && direction)
        {
            return mapping[direction] || mapping.axis;
        }
        return mapping.axis;
    }

    return LEGACY_XINPUT_AXIS_ALIAS_TO_SC[inputPart] || inputPart;
}

/**
 * Convert legacy numbered XInput controls to Star Citizen's semantic gamepad
 * tokens. Controller chords and keyboard-modified inputs are preserved.
 *
 * @param {string} inputString - e.g. "gp1_button11" or "gp1_axis1_positive"
 * @param {Object} options
 * @param {boolean} options.preserveAxisDirection - Use directional stick tokens
 *        for visual-template slots instead of the whole analog axis.
 * @returns {string}
 */
export function normalizeStarCitizenGamepadInput(inputString, { preserveAxisDirection = false } = {})
{
    if (typeof inputString !== 'string' || !inputString)
    {
        return inputString;
    }

    const match = inputString.match(/^(gp\d+)_(.+)$/i);
    if (!match)
    {
        return inputString;
    }

    const prefix = match[1].toLowerCase();
    const normalizedParts = match[2]
        .toLowerCase()
        .split('+')
        .map(part => normalizeGamepadInputPart(part, preserveAxisDirection));

    return `${prefix}_${normalizedParts.join('+')}`;
}

function getGamepadInputDisplayName(inputString)
{
    const normalized = normalizeStarCitizenGamepadInput(inputString, { preserveAxisDirection: true });
    const match = normalized && normalized.match(/^gp\d+_(.+)$/i);
    if (!match) return null;

    // Let the existing generic parsers handle non-XInput button, hat, and
    // axis identifiers that are still valid for some controller drivers.
    if (match[1].split('+').some(part => /^(?:button\d+|hat\d+_|axis\d+)/.test(part)))
    {
        return null;
    }

    return match[1]
        .split('+')
        .map(part => GAMEPAD_INPUT_LABELS[part] || part.replace(/_/g, ' ').toUpperCase())
        .join(' + ');
}

export function ensureSliderNumber(inputString)
{
    if (typeof inputString !== 'string' || !inputString)
    {
        return inputString;
    }

    return inputString.replace(/(^|[_+])slider(?=($|[_+]))/gi, '$1slider1');
}

/**
 * Parse a Star Citizen input string and return a friendly display name
 * @param {string} inputString - SC format like "js1_button3", "gp1_button3", "js1_hat1_up", "js2_axis1", "js2_axis1_positive"
 * @returns {string} - Friendly name like "Button 3", "Hat 1 Up", "Axis 1", "Axis 1 +"
 */
export function parseInputDisplayName(inputString)
{
    if (!inputString) return '';

    const gamepadDisplayName = getGamepadInputDisplayName(inputString);
    if (gamepadDisplayName) return gamepadDisplayName;

    // Hat switch: js1_hat1_up or gp1_hat1_up -> "Hat 1 Up"
    if (inputString.includes('_hat'))
    {
        const hatMatch = inputString.match(/hat(\d+)_(\w+)/);
        if (hatMatch)
        {
            const hatNum = hatMatch[1];
            const direction = hatMatch[2].charAt(0).toUpperCase() + hatMatch[2].slice(1);
            return `Hat ${hatNum} ${direction}`;
        }
    }

    // Button: js1_button3 or gp1_button3 -> "Button 3"
    if (inputString.includes('_button'))
    {
        const btnMatch = inputString.match(/button(\d+)/);
        if (btnMatch)
        {
            return `Button ${btnMatch[1]}`;
        }
    }

    // Axis with direction: js1_axis1_positive or gp1_axis1_positive -> "Axis 1 +"
    // Axis without direction: js1_axis1 or gp1_axis1 -> "Axis 1"
    if (inputString.includes('_axis'))
    {
        const axisMatch = inputString.match(/axis(\d+)(?:_(positive|negative))?/);
        if (axisMatch)
        {
            const axisNum = axisMatch[1];
            const direction = axisMatch[2];
            if (direction)
            {
                const symbol = direction === 'positive' ? '+' : '-';
                return `Axis ${axisNum} ${symbol}`;
            }
            return `Axis ${axisNum}`;
        }
    }

    // Fallback to the original string
    return inputString;
}

/**
 * Parse a Star Citizen input string and return a short display name
 * @param {string} inputString - SC format like "js1_button3", "js1_hat1_up", "js2_axis1", "js2_axis1_positive"
 * @returns {string} - Short name like "Btn 3", "Hat 1 Up", "Axis 1", "Axis 1 +"
 */
export function parseInputShortName(inputString)
{
    if (!inputString) return '';

    const gamepadDisplayName = getGamepadInputDisplayName(inputString);
    if (gamepadDisplayName) return gamepadDisplayName;

    // Hat switch: js1_hat1_up -> "Hat 1 Up"
    if (inputString.includes('_hat'))
    {
        const hatMatch = inputString.match(/hat(\d+)_(\w+)/);
        if (hatMatch)
        {
            const hatNum = hatMatch[1];
            const direction = hatMatch[2].charAt(0).toUpperCase() + hatMatch[2].slice(1);
            return `Hat ${hatNum} ${direction}`;
        }
    }

    // Button: js1_button3 -> "Btn 3"
    if (inputString.includes('_button'))
    {
        const btnMatch = inputString.match(/button(\d+)/);
        if (btnMatch)
        {
            return `Btn ${btnMatch[1]}`;
        }
    }

    // Axis with direction: js1_axis1_positive -> "Axis 1 +"
    // Axis without direction: js1_axis1 -> "Axis 1"
    if (inputString.includes('_axis'))
    {
        const axisMatch = inputString.match(/axis(\d+)(?:_(positive|negative))?/);
        if (axisMatch)
        {
            const axisNum = axisMatch[1];
            const direction = axisMatch[2];
            if (direction)
            {
                const symbol = direction === 'positive' ? '+' : '-';
                return `Axis ${axisNum} ${symbol}`;
            }
            return `Axis ${axisNum}`;
        }
    }

    // Fallback to the original string
    return inputString;
}

/**
 * Get the input type from a Star Citizen input string
 * @param {string} inputString - SC format like "js1_button3", "gp1_button3", "js1_hat1_up", "js2_axis1", "kb1_w"
 * @returns {string} - Type: "button", "hat", "axis", "keyboard", or "unknown"
 */
export function getInputType(inputString)
{
    if (!inputString) return 'unknown';

    if (inputString.includes('_hat')) return 'hat';
    if (inputString.includes('_button')) return 'button';
    if (inputString.includes('_axis')) return 'axis';
    if (inputString.startsWith('kb1_')) return 'keyboard';
    const normalizedGamepadInput = normalizeStarCitizenGamepadInput(inputString, { preserveAxisDirection: true });
    const gamepadMatch = normalizedGamepadInput.match(/^gp\d+_(.+)$/i);
    if (gamepadMatch)
    {
        const inputParts = gamepadMatch[1].toLowerCase().split('+');
        return inputParts.some(part => GAMEPAD_AXIS_INPUTS.has(part)) ? 'axis' : 'button';
    }
    if (/^js\d+_/i.test(inputString)) return 'gamepad';

    return 'unknown';
}

/**
 * Get the joystick/gamepad instance number from a Star Citizen input string
 * @param {string} inputString - SC format like "js1_button3", "gp1_button3", "js2_hat1_up"
 * @returns {number} - Device instance (1, 2, etc.) or 0 if not found
 */
export function getJoystickInstance(inputString)
{
    if (!inputString) return 0;

    // Match both js and gp prefixes
    const match = inputString.match(/(?:js|gp)(\d+)_/);
    return match ? parseInt(match[1]) : 0;
}

/**
 * Get the axis direction from a Star Citizen axis input string
 * @param {string} inputString - SC format like "js1_axis1_positive", "gp1_axis1_negative"
 * @returns {string|null} - "positive", "negative", or null if not an axis with direction
 */
export function getAxisDirection(inputString)
{
    if (!inputString || !inputString.includes('_axis')) return null;

    const match = inputString.match(/axis\d+_(positive|negative)/);
    return match ? match[1] : null;
}

/**
 * Get the axis number from a Star Citizen axis input string
 * @param {string} inputString - SC format like "js1_axis1", "gp1_axis1", or "js1_axis1_positive"
 * @returns {number} - Axis number or 0 if not found
 */
export function getAxisNumber(inputString)
{
    if (!inputString || !inputString.includes('_axis')) return 0;

    const match = inputString.match(/axis(\d+)/);
    return match ? parseInt(match[1]) : 0;
}

/**
 * Process a detected input result from the backend
 * @param {Object} result - Result from wait_for_input_binding
 * @returns {Object} - Processed result with additional helper properties
 */
export function processDetectedInput(result)
{
    if (!result) return null;

    const processed = {
        ...result,
        friendlyName: parseInputDisplayName(result.input_string),
        shortName: parseInputShortName(result.input_string),
        type: getInputType(result.input_string),
        joystickInstance: getJoystickInstance(result.input_string)
    };

    // Add axis-specific properties if this is an axis input
    if (processed.type === 'axis')
    {
        processed.axisDirection = getAxisDirection(result.input_string);
        processed.axisNumber = getAxisNumber(result.input_string);

        // Convert to Star Citizen format
        const jsInstance = processed.joystickInstance;
        const mapping = getAxisMapping(jsInstance);
        processed.scFormat = convertToSCAxisFormat(result.input_string, mapping);
        processed.shouldInvert = shouldInvertAxis(result.input_string);
    }

    return processed;
}

/**
 * Normalize HID axis names to Star Citizen axis tokens.
 * This handles common aliases like Slider/Dial/Wheel that SC expects as slider1/slider2.
 * @param {string} hidAxisName - HID axis name from descriptor (e.g., "X", "Rz", "Slider")
 * @returns {string|null} - SC axis token (e.g., "x", "rotz", "slider1") or null
 */
export function normalizeHidAxisNameToSCAxisName(hidAxisName)
{
    if (!hidAxisName || typeof hidAxisName !== 'string')
    {
        return null;
    }

    const normalized = hidAxisName.toLowerCase().replace(/\s+/g, '');

    const map = {
        'x': 'x',
        'y': 'y',
        'z': 'z',
        'rx': 'rotx',
        'ry': 'roty',
        'rz': 'rotz',
        'rotationx': 'rotx',
        'rotationy': 'roty',
        'rotationz': 'rotz',
        'slider': 'slider1',
        'slider1': 'slider1',
        'dial': 'slider2',
        'slider2': 'slider2',
        'wheel': 'slider2'
    };

    return ensureSliderNumber(map[normalized] || normalized);
}

/**
 * Convert any input string to Star Citizen format
 * For axes: converts "js1_axis3_positive" or "gp1_axis3_positive" to "js1_z" or "gp1_z"
 * For buttons/hats: returns unchanged
 * @param {string} inputString - Input string in any format
 * @returns {string} - Star Citizen compatible format
 */
export function toStarCitizenFormat(inputString)
{
    const normalizedGamepadInput = normalizeStarCitizenGamepadInput(inputString);
    if (normalizedGamepadInput !== inputString)
    {
        return ensureSliderNumber(normalizedGamepadInput);
    }

    const type = getInputType(inputString);

    if (type === 'axis')
    {
        const jsInstance = getJoystickInstance(inputString);
        const mapping = getAxisMapping(jsInstance);
        return ensureSliderNumber(convertToSCAxisFormat(inputString, mapping));
    }

    // Buttons and hats are already in correct format (both js and gp prefixes are valid)
    return ensureSliderNumber(inputString);
}
