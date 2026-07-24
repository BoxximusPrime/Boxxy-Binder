// Safely access TAURI APIs
let invoke, open, save;

if (window.__TAURI__)
{
    invoke = window.__TAURI__.core.invoke;
    ({ open, save } = window.__TAURI__.dialog);
}

// Import shared rendering utilities
import
{
    ButtonFrameWidth,
    ButtonFrameHeight,
    roundRect,
    simplifyButtonName,
    drawConnectingLine,
    drawButtonMarker,
    drawSingleButtonLabel,
    drawHat4WayFrames,
    drawButtonBox,
    RenderFrameText,
    getHat4WayPositions,
    getHat4WayBoxBounds,
    getHat2WayVerticalPositions,
    getHat2WayVerticalBoxBounds,
    getHat2WayHorizontalPositions,
    getHat2WayHorizontalBoxBounds,
    drawHat2WayVerticalBoxes,
    drawHat2WayHorizontalBoxes,
    HatFrameWidth,
    HatFrameHeight,
    MinButtonFrameWidth,
    MaxButtonFrameWidth,
    MinButtonFrameHeight,
    MaxButtonFrameHeight,
    getButtonFrameWidth,
    getButtonFrameHeight,
    getButtonBoxColor,
    normalizeButtonStyle,
    isValidHexColor
} from './button-renderer.js';
import { initializeTemplatePagesUI, refreshTemplatePagesUI } from './template-editor-v2.js';

import
{
    drawToggle3WayBoxes,
    drawRotaryBoxes,
    getToggle3WayPositions,
    getRotaryPositions
} from './input-type-renderer.js';
import { RenderButtonGraphic } from './button-graphic.js';

function refreshButtonGraphic()
{
    const container = document.getElementById('button-graphic-container');
    if (!container)
    {
        return;
    }

    const typeSelect = document.getElementById('button-type-select');
    const buttonType = (typeSelect && typeSelect.value) || (tempButton && tempButton.buttonType) || 'simple';
    const stage = document.querySelector('.button-graphic-stage');
    if (stage)
    {
        stage.dataset.buttonType = buttonType;
    }

    RenderButtonGraphic(container, buttonType, tempButton);
}

function getButtonGraphicSocketForSlot(slot)
{
    if (!slot)
    {
        return null;
    }

    if (slot === 'main')
    {
        return document.getElementById('button-input-socket');
    }

    return document.querySelector(`.hat-input-socket[data-direction="${slot}"]`);
}

function getSlotFromGraphicTarget(target)
{
    if (!(target instanceof Element))
    {
        return null;
    }

    let current = target;
    while (current && !current.classList?.contains('button-graphic-svg'))
    {
        const slotClass = Array.from(current.classList || []).find(className => className.startsWith('slot-'));
        if (slotClass)
        {
            return slotClass.slice(5);
        }

        current = current.parentElement;
    }

    return null;
}

function triggerButtonGraphicSlotBinding(slot)
{
    if (!slot)
    {
        return;
    }

    if (slot === 'main')
    {
        startInputDetection();
        return;
    }

    startHatInputDetection(slot);
}

function initializeButtonGraphicInteractions()
{
    const container = document.getElementById('button-graphic-container');
    if (!container || container.dataset.interactionsBound === 'true')
    {
        return;
    }

    container.dataset.interactionsBound = 'true';

    container.addEventListener('mouseover', (event) =>
    {
        const slot = getSlotFromGraphicTarget(event.target);
        if (!slot)
        {
            return;
        }

        const socket = getButtonGraphicSocketForSlot(slot);
        setButtonGraphicHoverSlot(slot, socket);
    });

    container.addEventListener('mouseout', (event) =>
    {
        const currentSlot = getSlotFromGraphicTarget(event.target);
        if (!currentSlot)
        {
            return;
        }

        const nextSlot = getSlotFromGraphicTarget(event.relatedTarget);
        if (nextSlot === currentSlot)
        {
            return;
        }

        clearButtonGraphicHoverSlot();
    });

    container.addEventListener('click', (event) =>
    {
        const slot = getSlotFromGraphicTarget(event.target);
        if (!slot)
        {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        triggerButtonGraphicSlotBinding(slot);
    });
}

function formatBindingOverlayLabel(text)
{
    if (!text)
    {
        return 'Input';
    }

    return String(text)
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
}

let bindingOverlayCountdownInterval = null;

function clearBindingOverlayCountdown()
{
    if (bindingOverlayCountdownInterval !== null)
    {
        clearInterval(bindingOverlayCountdownInterval);
        bindingOverlayCountdownInterval = null;
    }
}

function setBindingOverlayTimer(text = '', { hidden = false, isError = false } = {})
{
    const timerEl = document.getElementById('button-binding-overlay-timer');
    if (!timerEl)
    {
        return;
    }

    timerEl.hidden = hidden;
    timerEl.textContent = hidden ? '' : text;
    timerEl.style.color = isError ? '#ef4444' : '';
}

function startBindingOverlayCountdown(seconds)
{
    clearBindingOverlayCountdown();

    let remaining = Math.max(0, Math.ceil(Number(seconds) || 0));
    if (remaining <= 0)
    {
        setBindingOverlayTimer('', { hidden: true });
        return;
    }

    const renderCountdown = () =>
    {
        setBindingOverlayTimer(`${remaining}s remaining`);
    };

    renderCountdown();
    bindingOverlayCountdownInterval = setInterval(() =>
    {
        remaining -= 1;
        if (remaining <= 0)
        {
            clearBindingOverlayCountdown();
            setBindingOverlayTimer('Timed Out', { isError: true });
            return;
        }

        renderCountdown();
    }, 1000);
}

function stopBindingOverlayCountdown({ hideTimer = true } = {})
{
    clearBindingOverlayCountdown();
    if (hideTimer)
    {
        setBindingOverlayTimer('', { hidden: true });
    }
}

function resetBindingOverlayState()
{
    stopBindingOverlayCountdown();

    const titleEl = document.getElementById('button-binding-overlay-title');
    const subtitleEl = document.getElementById('button-binding-overlay-subtitle');
    if (titleEl)
    {
        titleEl.textContent = 'Press Button';
    }

    if (subtitleEl)
    {
        subtitleEl.textContent = 'Listening for input...';
    }

    const inputStatusEl = document.getElementById('input-detection-status');
    if (inputStatusEl)
    {
        inputStatusEl.style.display = 'none';
        inputStatusEl.textContent = '';
        inputStatusEl.style.color = '';
    }

    const hatStatusEl = document.getElementById('hat-detection-status');
    if (hatStatusEl)
    {
        hatStatusEl.style.display = 'none';
        hatStatusEl.textContent = '';
        hatStatusEl.style.color = '';
    }
}

function delay(ms)
{
    return new Promise(resolve => setTimeout(resolve, ms));
}

function showBindingOverlay(title, subtitle = 'Listening for input...', timeoutSecs = 0)
{
    const overlay = document.getElementById('button-binding-overlay');
    if (!overlay)
    {
        return;
    }

    resetBindingOverlayState();

    const titleEl = document.getElementById('button-binding-overlay-title');
    const subtitleEl = document.getElementById('button-binding-overlay-subtitle');

    if (titleEl)
    {
        titleEl.textContent = title || 'Press Button';
    }

    if (subtitleEl)
    {
        subtitleEl.textContent = subtitle || 'Listening for input...';
    }

    const capturedEl = document.getElementById('button-binding-overlay-captured');
    if (capturedEl)
    {
        capturedEl.hidden = true;
        capturedEl.textContent = '';
    }

    const optionsEl = document.getElementById('button-binding-overlay-options');
    if (optionsEl)
    {
        optionsEl.hidden = true;
        optionsEl.replaceChildren();
    }

    if (timeoutSecs > 0)
    {
        startBindingOverlayCountdown(timeoutSecs);
    }

    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
}

function hideBindingOverlay()
{
    const overlay = document.getElementById('button-binding-overlay');
    if (!overlay)
    {
        return;
    }

    resetBindingOverlayState();

    const capturedEl = document.getElementById('button-binding-overlay-captured');
    if (capturedEl)
    {
        capturedEl.hidden = true;
        capturedEl.textContent = '';
    }

    const optionsEl = document.getElementById('button-binding-overlay-options');
    if (optionsEl)
    {
        optionsEl.hidden = true;
        optionsEl.replaceChildren();
    }

    if (pendingBindingOverlayChoiceResolve)
    {
        const resolveChoice = pendingBindingOverlayChoiceResolve;
        pendingBindingOverlayChoiceResolve = null;
        resolveChoice(null);
    }

    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
}

function formatBindingOverlayCapturedInput(result)
{
    if (!result || !result.input_string)
    {
        return 'Unknown Input';
    }

    if (typeof parseInputShortName === 'function')
    {
        return parseInputShortName(result.input_string);
    }

    return result.display_name || result.input_string;
}

function updateBindingOverlayCapturedInputs(inputs)
{
    const capturedEl = document.getElementById('button-binding-overlay-captured');
    const subtitleEl = document.getElementById('button-binding-overlay-subtitle');
    if (!capturedEl)
    {
        return;
    }

    if (!Array.isArray(inputs) || inputs.length === 0)
    {
        capturedEl.hidden = true;
        capturedEl.textContent = '';
        return;
    }

    stopBindingOverlayCountdown();

    const labels = inputs.map(formatBindingOverlayCapturedInput);
    capturedEl.hidden = false;
    capturedEl.textContent = labels.length === 1
        ? `Captured: ${labels[0]}`
        : `Captured: ${labels.join(' • ')}`;

    if (subtitleEl && labels.length > 1)
    {
        subtitleEl.textContent = 'Multiple inputs captured...';
    }
}

function chooseBindingOverlayInput(inputs)
{
    const titleEl = document.getElementById('button-binding-overlay-title');
    const subtitleEl = document.getElementById('button-binding-overlay-subtitle');
    const optionsEl = document.getElementById('button-binding-overlay-options');

    if (!optionsEl)
    {
        return Promise.resolve(inputs[inputs.length - 1] || null);
    }

    if (titleEl)
    {
        titleEl.textContent = 'Choose Input';
    }

    if (subtitleEl)
    {
        subtitleEl.textContent = 'Multiple inputs captured. Pick one to bind.';
    }

    optionsEl.hidden = false;
    optionsEl.replaceChildren();

    return new Promise((resolve) =>
    {
        pendingBindingOverlayChoiceResolve = resolve;

        inputs.forEach((input) =>
        {
            const optionBtn = document.createElement('button');
            optionBtn.type = 'button';
            optionBtn.className = 'button-binding-overlay-option';
            optionBtn.textContent = formatBindingOverlayCapturedInput(input);
            optionBtn.addEventListener('click', () =>
            {
                pendingBindingOverlayChoiceResolve = null;
                resolve(input);
            }, { once: true });
            optionsEl.appendChild(optionBtn);
        });
    });
}

/**
 * Migrate template from v1.0 to v1.1
 * - Rename joystickNumber to devicePrefix
 * - Convert joystickNumber value (integer) to devicePrefix (string like "js1", "js2")
 * - Remove device-specific prefixes from button inputs (e.g., "js1_button3" becomes "button3")
 * - Update template version to 1.1
 */
function migrateTemplateToV11(template)
{
    console.log('[Migration] Starting migration to v1.1...');

    if (!template || typeof template !== 'object')
    {
        console.log('[Migration] Invalid template object');
        return template;
    }

    let migrated = false;

    // Migrate pages
    if (template.pages && Array.isArray(template.pages))
    {
        template.pages.forEach((page, pageIndex) =>
        {
            // Check if page has old joystickNumber field
            if (page.joystickNumber !== undefined && page.device_prefix === undefined && page.devicePrefix === undefined)
            {
                // Convert joystickNumber to device_prefix
                const oldNumber = page.joystickNumber;
                page.device_prefix = `js${oldNumber}`;
                delete page.joystickNumber;
                console.log(`[Migration] Page ${pageIndex} (${page.name}): joystickNumber ${oldNumber} -> device_prefix "${page.device_prefix}"`);
                migrated = true;

                // Remove prefixes from all button inputs
                if (page.buttons && Array.isArray(page.buttons))
                {
                    page.buttons.forEach((button, buttonIndex) =>
                    {
                        if (button.inputs && typeof button.inputs === 'object')
                        {
                            Object.keys(button.inputs).forEach(key =>
                            {
                                const oldInput = button.inputs[key];
                                if (typeof oldInput === 'string')
                                {
                                    // Remove prefix like "js1_", "js2_", "gp1_", etc.
                                    const newInput = oldInput.replace(/^(js\d+|gp\d+)_/, '');
                                    if (newInput !== oldInput)
                                    {
                                        button.inputs[key] = newInput;
                                        console.log(`[Migration]   Button ${buttonIndex} (${button.name}): "${oldInput}" -> "${newInput}"`);
                                    }
                                }
                            });
                        }
                    });
                }
            }
            // Also migrate devicePrefix (camelCase) to device_prefix (snake_case) for consistency
            else if (page.devicePrefix !== undefined && page.device_prefix === undefined)
            {
                page.device_prefix = page.devicePrefix || '';
                delete page.devicePrefix;
                console.log(`[Migration] Page ${pageIndex} (${page.name}): devicePrefix -> device_prefix "${page.device_prefix}"`);
                migrated = true;
            }
        });
    }

    // Also check legacy leftStick/rightStick structures
    if (template.leftStick && typeof template.leftStick === 'object')
    {
        if (template.leftStick.joystickNumber !== undefined && template.leftStick.device_prefix === undefined)
        {
            template.leftStick.device_prefix = `js${template.leftStick.joystickNumber}`;
            delete template.leftStick.joystickNumber;
            migrated = true;

            // Migrate buttons
            if (Array.isArray(template.leftStick.buttons))
            {
                template.leftStick.buttons.forEach(button =>
                {
                    if (button.inputs)
                    {
                        Object.keys(button.inputs).forEach(key =>
                        {
                            const oldInput = button.inputs[key];
                            if (typeof oldInput === 'string')
                            {
                                button.inputs[key] = oldInput.replace(/^(js\d+|gp\d+)_/, '');
                            }
                        });
                    }
                });
            }
        }
    }

    if (template.rightStick && typeof template.rightStick === 'object')
    {
        if (template.rightStick.joystickNumber !== undefined && template.rightStick.device_prefix === undefined)
        {
            template.rightStick.device_prefix = `js${template.rightStick.joystickNumber}`;
            delete template.rightStick.joystickNumber;
            migrated = true;

            // Migrate buttons
            if (Array.isArray(template.rightStick.buttons))
            {
                template.rightStick.buttons.forEach(button =>
                {
                    if (button.inputs)
                    {
                        Object.keys(button.inputs).forEach(key =>
                        {
                            const oldInput = button.inputs[key];
                            if (typeof oldInput === 'string')
                            {
                                button.inputs[key] = oldInput.replace(/^(js\d+|gp\d+)_/, '');
                            }
                        });
                    }
                });
            }
        }
    }

    // Update version if migration occurred
    if (migrated)
    {
        template.version = '1.1';
        console.log('[Migration] Template migrated to v1.1');
    }

    return template;
}

function ensureTemplateSliderNumber(inputString)
{
    if (typeof inputString !== 'string' || !inputString)
    {
        return inputString;
    }

    return inputString.replace(/(^|[_+])slider(?=($|[_+]))/gi, '$1slider1');
}

function normalizeTemplateButtonInputs(button)
{
    if (!button || typeof button !== 'object')
    {
        return;
    }

    if (button.inputs && typeof button.inputs === 'object')
    {
        Object.keys(button.inputs).forEach(key =>
        {
            if (typeof button.inputs[key] === 'string')
            {
                button.inputs[key] = ensureTemplateSliderNumber(button.inputs[key]);
            }
        });
    }

    if (button.inputType === 'axis' && typeof button.inputId === 'string')
    {
        button.inputId = ensureTemplateSliderNumber(button.inputId);
    }
}

function normalizeTemplateSliderIds(template)
{
    if (!template || typeof template !== 'object')
    {
        return template;
    }

    if (Array.isArray(template.buttons))
    {
        template.buttons.forEach(normalizeTemplateButtonInputs);
    }

    if (Array.isArray(template.pages))
    {
        template.pages.forEach(page =>
        {
            if (Array.isArray(page?.buttons))
            {
                page.buttons.forEach(normalizeTemplateButtonInputs);
            }
        });
    }

    if (Array.isArray(template.leftStick?.buttons))
    {
        template.leftStick.buttons.forEach(normalizeTemplateButtonInputs);
    }

    if (Array.isArray(template.rightStick?.buttons))
    {
        template.rightStick.buttons.forEach(normalizeTemplateButtonInputs);
    }

    return template;
}

// Lazy imports - will be loaded when needed
let parseInputDisplayName, parseInputShortName, getInputType, toStarCitizenFormat, normalizeStarCitizenGamepadInput, normalizeHidAxisNameToSCAxisName, ensureSliderNumber;

// Load utilities when template editor initializes
async function loadUtilities()
{
    if (!parseInputDisplayName)
    {
        const utils = await import('./input-utils.js');
        parseInputDisplayName = utils.parseInputDisplayName;
        parseInputShortName = utils.parseInputShortName;
        getInputType = utils.getInputType;
        toStarCitizenFormat = utils.toStarCitizenFormat;
        normalizeStarCitizenGamepadInput = utils.normalizeStarCitizenGamepadInput;
        normalizeHidAxisNameToSCAxisName = utils.normalizeHidAxisNameToSCAxisName;
        ensureSliderNumber = utils.ensureSliderNumber;
    }
}

// State
let templateData = {
    name: '',
    version: '1.1',
    pages: []
};

let currentStick = 'right'; // Currently editing 'left' or 'right'
let currentPageId = null;
let canvas, ctx;
let loadedImage = null;
let zoom = 1.0;
let pan = { x: 0, y: 0 };

// Camera positions for each stick (persisted separately)
let leftStickCamera = { zoom: 1.0, pan: { x: 0, y: 0 } };
let rightStickCamera = { zoom: 1.0, pan: { x: 0, y: 0 } };
let selectedButtonId = null;
let mode = 'view'; // 'view', 'placing-button', 'placing-label'
let tempButton = null;
let placementPreviewPos = null;
let originalButton = null; // Store original button data for cancel functionality
let draggingHandle = null;
let isPanning = false;
let lastPanPosition = { x: 0, y: 0 };

// Snapping grid for better alignment when dragging boxes
const SNAP_GRID = 10; // pixels
const DefaultButtonColor = '#2f7f78';

function getStyleControls()
{
    return {
        panel: document.getElementById('button-appearance-panel'),
        widthSection: document.getElementById('button-width-section'),
        widthField: document.getElementById('button-width-field'),
        widthRange: document.getElementById('button-width-range'),
        widthInput: document.getElementById('button-width-input'),
        heightSection: document.getElementById('button-height-section'),
        heightField: document.getElementById('button-height-field'),
        heightRange: document.getElementById('button-height-range'),
        heightInput: document.getElementById('button-height-input'),
        colorInput: document.getElementById('button-color-input'),
        colorHexInput: document.getElementById('button-color-hex-input'),
        presetButtons: document.querySelectorAll('.button-color-preset')
    };
}

function clearCurrentTemplateFilePath()
{
    currentTemplateFilePath = null;
    localStorage.removeItem('editorTemplateFilePath');
    localStorage.removeItem('editorTemplateFileName');
    showUnsavedTemplateIndicator();
    updateTemplateUnsavedIndicator();
}

function isMissingPathSaveError(error)
{
    const message = String(error || '').toLowerCase();
    return message.includes('cannot find the path specified') ||
        message.includes('os error 3') ||
        message.includes('no such file or directory') ||
        message.includes('path not found');
}

function setActiveColorPreset(color)
{
    const normalizedColor = isValidHexColor(color) ? color.toLowerCase() : '';
    getStyleControls().presetButtons.forEach(button =>
    {
        button.classList.toggle('active', (button.dataset.color || '').toLowerCase() === normalizedColor);
    });
}

function setModalColorValue(color)
{
    const { colorInput, colorHexInput } = getStyleControls();
    const normalizedColor = isValidHexColor(color) ? color.toLowerCase() : '';

    if (colorInput)
    {
        colorInput.value = normalizedColor || DefaultButtonColor;
    }
    if (colorHexInput)
    {
        colorHexInput.value = normalizedColor;
    }

    setActiveColorPreset(normalizedColor);
}

function setModalWidthValue(width)
{
    const { widthRange, widthInput } = getStyleControls();
    const safeWidth = Math.max(MinButtonFrameWidth, Math.min(MaxButtonFrameWidth, Number(width) || ButtonFrameWidth));

    if (widthRange)
    {
        widthRange.value = safeWidth;
    }
    if (widthInput)
    {
        widthInput.value = safeWidth;
    }
}

function setModalHeightValue(height)
{
    const { heightRange, heightInput } = getStyleControls();
    const safeHeight = Math.max(MinButtonFrameHeight, Math.min(MaxButtonFrameHeight, Number(height) || ButtonFrameHeight));

    if (heightRange)
    {
        heightRange.value = safeHeight;
    }
    if (heightInput)
    {
        heightInput.value = safeHeight;
    }
}

function isWidthAdjustableButtonType(buttonType)
{
    return [
        'simple',
        'axis',
        'hat4way',
        'hat2way-vertical',
        'hat2way-horizontal',
        'toggle3way-vertical',
        'toggle3way-horizontal',
        'rotary3way',
        'rotary4way'
    ].includes(buttonType);
}

function isHeightAdjustableButtonType(buttonType)
{
    return isWidthAdjustableButtonType(buttonType);
}

function getDefaultButtonWidth(buttonType)
{
    return buttonType && buttonType !== 'simple' && buttonType !== 'axis'
        ? HatFrameWidth
        : ButtonFrameWidth;
}

function getDefaultButtonHeight(buttonType)
{
    return buttonType && buttonType !== 'simple' && buttonType !== 'axis'
        ? HatFrameHeight
        : ButtonFrameHeight;
}

function setButtonAppearancePanelVisible(isVisible)
{
    const { panel } = getStyleControls();
    if (!panel)
    {
        return;
    }

    panel.classList.toggle('visible', Boolean(isVisible));
    panel.setAttribute('aria-hidden', String(!isVisible));
}

function updateButtonAppearancePanelHeading(button = getActiveStyleButton())
{
    const eyebrow = document.getElementById('button-appearance-panel-eyebrow');
    if (!eyebrow)
    {
        return;
    }

    const buttonName = String(button?.name || '').trim();
    eyebrow.textContent = buttonName ? `Button Appearance - ${buttonName}` : 'Button Appearance';
}

function populateButtonStyleControls(button)
{
    const style = normalizeButtonStyle(button?.style);
    setModalWidthValue(style.width || getDefaultButtonWidth(button?.buttonType));
    setModalHeightValue(style.height || getDefaultButtonHeight(button?.buttonType));
    setModalColorValue(style.color || '');
    updateButtonAppearancePanelHeading(button);
}

function getSelectedButton()
{
    if (selectedButtonId === null)
    {
        return null;
    }

    return getCurrentButtons().find(button => String(button.id) === String(selectedButtonId)) || null;
}

function getActiveStyleButton()
{
    return tempButton || getSelectedButton();
}

function getNextButtonZOrder(buttons)
{
    return (buttons || []).reduce((highestZ, button, index) =>
    {
        const buttonZ = Number.isFinite(Number(button?.z)) ? Number(button.z) : index;
        return Math.max(highestZ, buttonZ);
    }, -1) + 1;
}

function getButtonsInDrawOrder(buttons = getCurrentButtons())
{
    return (buttons || [])
        .map((button, index) => ({
            button,
            index,
            z: Number.isFinite(Number(button?.z)) ? Number(button.z) : index
        }))
        .sort((left, right) =>
        {
            if (left.z !== right.z)
            {
                return left.z - right.z;
            }

            return left.index - right.index;
        })
        .map(entry => entry.button);
}

function getButtonsInHitTestOrder(buttons = getCurrentButtons())
{
    return [...getButtonsInDrawOrder(buttons)].reverse();
}

function createUniqueButtonId(buttons)
{
    const usedIds = new Set((buttons || []).map(button => String(button?.id)));
    let nextId = Date.now();

    while (usedIds.has(String(nextId)))
    {
        nextId += 1;
    }

    return nextId;
}

function getNextDuplicateButtonName(sourceName, buttons)
{
    const trimmedName = String(sourceName || '').trim() || 'Button';
    const suffixMatch = trimmedName.match(/^(.*?)(\d+)$/);
    const usedNames = new Set(
        (buttons || [])
            .map(button => String(button?.name || '').trim().toLowerCase())
            .filter(Boolean)
    );

    let namePrefix = `${trimmedName} `;
    let nextNumber = 2;

    if (suffixMatch)
    {
        namePrefix = suffixMatch[1];
        nextNumber = Number.parseInt(suffixMatch[2], 10) + 1;
    }

    let candidateName = `${namePrefix}${nextNumber}`;
    while (usedNames.has(candidateName.toLowerCase()))
    {
        nextNumber += 1;
        candidateName = `${namePrefix}${nextNumber}`;
    }

    return candidateName;
}

function duplicateButton(button, buttons)
{
    if (!button)
    {
        return null;
    }

    const duplicate = JSON.parse(JSON.stringify(button));
    duplicate.id = createUniqueButtonId(buttons);
    duplicate.name = getNextDuplicateButtonName(button.name, buttons);
    duplicate.z = getNextButtonZOrder(buttons);

    if (duplicate.buttonPos)
    {
        duplicate.buttonPos = {
            ...duplicate.buttonPos,
            x: snapToGrid(duplicate.buttonPos.x + SNAP_GRID),
            y: snapToGrid(duplicate.buttonPos.y + SNAP_GRID)
        };
    }

    if (duplicate.labelPos)
    {
        duplicate.labelPos = {
            ...duplicate.labelPos,
            x: snapToGrid(duplicate.labelPos.x + SNAP_GRID),
            y: snapToGrid(duplicate.labelPos.y + SNAP_GRID)
        };
    }

    return duplicate;
}

function duplicateSelectedButton(event)
{
    if (event)
    {
        event.preventDefault();
        event.stopPropagation();
    }

    const selectedButton = getSelectedButton();
    if (!selectedButton)
    {
        return;
    }

    const buttons = getCurrentButtons();
    const duplicate = duplicateButton(selectedButton, buttons);
    if (!duplicate)
    {
        return;
    }

    setCurrentButtons([...buttons, duplicate]);
    markAsChanged();
    updateButtonList();
    selectButton(duplicate.id);
    redraw();

    if (window.toast)
    {
        window.toast.success(`Duplicated "${selectedButton.name}" as "${duplicate.name}"`);
    }
}

function applyAppearanceControlsToActiveButton()
{
    const button = getActiveStyleButton();
    if (!button)
    {
        return;
    }

    const buttonType = tempButton
        ? (document.getElementById('button-type-select')?.value || button.buttonType || 'simple')
        : (button.buttonType || 'simple');

    try
    {
        const style = getButtonStyleFromModal(buttonType);
        if (style)
        {
            button.style = style;
        }
        else
        {
            delete button.style;
        }
    }
    catch
    {
        return;
    }

    if (!tempButton)
    {
        markAsChanged();
    }

    updateButtonList();
    redraw();
    refreshButtonGraphic();
}

function getButtonStyleFromModal(buttonType)
{
    const { widthInput, heightInput, colorHexInput } = getStyleControls();
    const style = {};

    const rawColor = (colorHexInput?.value || '').trim();
    if (rawColor)
    {
        if (!isValidHexColor(rawColor))
        {
            throw new Error('Button color must be a hex value like #4ec9b0.');
        }
        style.color = rawColor.toLowerCase();
    }

    if (isWidthAdjustableButtonType(buttonType))
    {
        const rawWidth = Number(widthInput?.value);
        const defaultWidth = getDefaultButtonWidth(buttonType);
        if (Number.isFinite(rawWidth) && rawWidth !== defaultWidth)
        {
            style.width = Math.max(MinButtonFrameWidth, Math.min(MaxButtonFrameWidth, Math.round(rawWidth)));
        }
    }

    if (isHeightAdjustableButtonType(buttonType))
    {
        const rawHeight = Number(heightInput?.value);
        const defaultHeight = getDefaultButtonHeight(buttonType);
        if (Number.isFinite(rawHeight) && rawHeight !== defaultHeight)
        {
            style.height = Math.max(MinButtonFrameHeight, Math.min(MaxButtonFrameHeight, Math.round(rawHeight)));
        }
    }

    return Object.keys(style).length > 0 ? style : null;
}

function initializeButtonStyleControls()
{
    const { widthRange, widthInput, heightRange, heightInput, colorInput, colorHexInput, presetButtons } = getStyleControls();

    const syncWidth = (value) =>
    {
        setModalWidthValue(value);
        applyAppearanceControlsToActiveButton();
    };
    widthRange?.addEventListener('input', (event) => syncWidth(event.target.value));
    widthInput?.addEventListener('input', (event) => syncWidth(event.target.value));

    const syncHeight = (value) =>
    {
        setModalHeightValue(value);
        applyAppearanceControlsToActiveButton();
    };
    heightRange?.addEventListener('input', (event) => syncHeight(event.target.value));
    heightInput?.addEventListener('input', (event) => syncHeight(event.target.value));

    document.getElementById('button-width-reset-btn')?.addEventListener('click', () =>
    {
        const activeButton = getActiveStyleButton();
        const buttonType = tempButton
            ? (document.getElementById('button-type-select')?.value || activeButton?.buttonType || 'simple')
            : (activeButton?.buttonType || 'simple');

        setModalWidthValue(getDefaultButtonWidth(buttonType));
        applyAppearanceControlsToActiveButton();
    });

    document.getElementById('button-height-reset-btn')?.addEventListener('click', () =>
    {
        const activeButton = getActiveStyleButton();
        const buttonType = tempButton
            ? (document.getElementById('button-type-select')?.value || activeButton?.buttonType || 'simple')
            : (activeButton?.buttonType || 'simple');

        setModalHeightValue(getDefaultButtonHeight(buttonType));
        applyAppearanceControlsToActiveButton();
    });

    colorInput?.addEventListener('input', (event) =>
    {
        setModalColorValue(event.target.value);
        applyAppearanceControlsToActiveButton();
    });
    colorHexInput?.addEventListener('input', (event) =>
    {
        const value = event.target.value.trim();
        if (value === '' || isValidHexColor(value))
        {
            setModalColorValue(value);
            applyAppearanceControlsToActiveButton();
        }
    });

    presetButtons.forEach(button =>
    {
        button.addEventListener('click', () =>
        {
            setModalColorValue(button.dataset.color || '');
            applyAppearanceControlsToActiveButton();
        });
    });
}

function generatePageId()
{
    if (window.crypto && window.crypto.randomUUID)
    {
        return window.crypto.randomUUID();
    }
    return `page_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function syncLegacyStickReferences()
{
    if (!Array.isArray(templateData.pages))
    {
        templateData.pages = [];
    }

    templateData.leftStick = templateData.pages[0] || { joystickNumber: 1, buttons: [] };
    templateData.rightStick = templateData.pages[1] || { joystickNumber: 2, buttons: [] };
}

function ensureTemplatePages()
{
    if (!Array.isArray(templateData.pages))
    {
        templateData.pages = [];
    }

    // Process existing pages to ensure they have IDs and button arrays
    templateData.pages.forEach((page, index) =>
    {
        if (!page.id)
        {
            page.id = generatePageId();
        }
        if (!Array.isArray(page.buttons))
        {
            page.buttons = [];
        }
        // Only set joystickNumber if neither device_prefix nor joystickNumber exist
        if (page.joystickNumber === undefined && page.device_prefix === undefined && page.devicePrefix === undefined)
        {
            page.device_prefix = index === 0 ? 'js1' : 'js2';
        }
        if (!page.name)
        {
            page.name = index === 0 ? 'Left Stick' : 'Right Stick';
        }
    });

    syncLegacyStickReferences();

    if (!currentPageId && templateData.pages.length)
    {
        currentPageId = templateData.pages[0].id;
    }
}

function handleTemplatePagesChanged()
{
    syncLegacyStickReferences();
    markAsChanged();
    updateButtonList();
    redraw();
}

function handleTemplatePageSelected(pageId)
{
    if (!pageId)
    {
        return;
    }

    currentPageId = pageId;

    // Find the page and load its data
    if (Array.isArray(templateData.pages))
    {
        const page = templateData.pages.find(p => p.id === pageId);
        if (page)
        {
            // Update button list to show this page's buttons
            updateButtonList();

            // Clear selection when switching pages
            selectButton(null);

            // Load the page's image (or mirrored image) - this will call redraw when done
            loadPageImage(page);
        }
    }
}// Helper function to resize image to max width of 1024px while maintaining aspect ratio
function resizeImage(img, maxWidth = 1024, callback)
{
    // If image is already smaller than maxWidth, use it as is
    if (img.width <= maxWidth)
    {
        if (callback)
        {
            // Use setTimeout to make it async like the resize case
            setTimeout(() => callback(img), 0);
        }
        return;
    }

    // Calculate new dimensions maintaining aspect ratio
    const ratio = maxWidth / img.width;
    const newWidth = maxWidth;
    const newHeight = Math.round(img.height * ratio);

    // Create a canvas to resize the image
    const resizeCanvas = document.createElement('canvas');
    resizeCanvas.width = newWidth;
    resizeCanvas.height = newHeight;

    const resizeCtx = resizeCanvas.getContext('2d');
    resizeCtx.imageSmoothingEnabled = true;
    resizeCtx.imageSmoothingQuality = 'high';

    // Draw the resized image
    resizeCtx.drawImage(img, 0, 0, newWidth, newHeight);

    // Create a new image from the resized canvas
    const resizedImg = new Image();
    resizedImg.onload = () =>
    {
        if (callback)
        {
            callback(resizedImg);
        }
    };
    resizedImg.src = resizeCanvas.toDataURL('image/png');
}

// Load image for a specific page (handles mirroring)
function loadPageImage(page)
{
    if (!page) return;

    const processImage = (imageDataUrl) =>
    {
        const img = new Image();

        const handleImageLoad = () =>
        {
            resizeImage(img, 1024, (resizedImg) =>
            {
                loadedImage = resizedImg;
                redraw();
            });
        };

        // Handle both cached and uncached images
        img.onload = handleImageLoad;
        img.src = imageDataUrl;

        // For cached images, check after a microtask
        setTimeout(() =>
        {
            if (img.complete && img.naturalWidth > 0)
            {
                handleImageLoad();
            }
        }, 0);
    };

    // Check if this page mirrors another page
    if (page.mirror_from_page_id)
    {
        const mirrorPage = templateData.pages.find(p => p.id === page.mirror_from_page_id);
        if (mirrorPage && mirrorPage.image_data_url)
        {
            processImage(mirrorPage.image_data_url);
            return;
        }
    }

    // Use this page's own image
    if (page.image_data_url)
    {
        processImage(page.image_data_url);
    }
    else
    {
        // No image for this page
        loadedImage = null;
        redraw();
    }
}

// Joystick input detection
let detectingInput = false;
let inputDetectionTimeout = null; // Track timeout to clear it when restarting
let hatDetectionTimeout = null; // Track hat detection timeout to clear it when restarting
let currentDetectionSessionId = null; // Track current detection session to prevent race conditions
let currentHatDetectionSessionId = null; // Track current hat detection session
let pendingBindingOverlayChoiceResolve = null;

// Track unsaved changes
let hasUnsavedChanges = false;

// Track current template file path for auto-saving
let currentTemplateFilePath = null;

// Export initialization function for tab system
window.initializeTemplateEditor = function ()
{
    if (canvas) return; // Already initialized

    // Load utilities first
    loadUtilities();

    ensureTemplatePages();

    canvas = document.getElementById('editor-canvas');
    ctx = canvas.getContext('2d');

    initializeEventListeners();
    loadPersistedTemplate();

    initializeTemplatePagesUI({
        template: templateData,
        getTemplate: () => templateData,
        onPagesChanged: handleTemplatePagesChanged,
        onPageSelected: handleTemplatePageSelected
    });

    // Ensure canvas is sized after layout is complete
    requestAnimationFrame(() =>
    {
        resizeCanvas();
    });

    window.addEventListener('resize', resizeCanvas);

    // Listen for theme changes to refresh canvas
    document.addEventListener('themechange', () =>
    {
        console.log('Theme changed, refreshing canvas...');
        redraw();
    });
};

function initializeEventListeners()
{
    // Page selector buttons are now handled dynamically by template-editor-v2.js
    // No need to listen on a static dropdown anymore

    document.getElementById('save-template-btn').addEventListener('click', saveTemplate);
    document.getElementById('save-template-as-btn').addEventListener('click', saveTemplateAs);
    document.getElementById('load-template-btn').addEventListener('click', loadTemplate);

    // Sidebar controls
    document.getElementById('template-name').addEventListener('input', (e) =>
    {
        templateData.name = e.target.value;
        markAsChanged();
        if (window.updateTemplateIndicator)
        {
            const savedFileName = localStorage.getItem('templateFileName');
            window.updateTemplateIndicator(e.target.value, savedFileName);
        }
    });



    // Legacy image controls removed - per-page images now handled in template page modal
    document.getElementById('new-template-btn').addEventListener('click', newTemplate);
    document.getElementById('add-button-btn').addEventListener('click', startAddButton);
    document.getElementById('delete-button-btn').addEventListener('click', deleteSelectedButton);
    document.getElementById('clear-all-btn').addEventListener('click', clearAllButtons);
    document.getElementById('mirror-template-btn').addEventListener('click', mirrorTemplate);




    // Zoom controls
    document.getElementById('zoom-in-btn').addEventListener('click', () => zoomBy(0.1));
    document.getElementById('zoom-out-btn').addEventListener('click', () => zoomBy(-0.1));
    document.getElementById('zoom-fit-btn').addEventListener('click', fitToScreen);
    document.getElementById('zoom-reset-btn').addEventListener('click', resetZoom);    // Canvas events
    canvas.addEventListener('mousedown', onCanvasMouseDown);
    canvas.addEventListener('dblclick', onCanvasDoubleClick);
    canvas.addEventListener('mousemove', onCanvasMouseMove);
    canvas.addEventListener('wheel', onCanvasWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // Prevent right-click menu

    // Global mouseup to catch releases outside canvas (fixes panning stuck bug)
    document.addEventListener('mouseup', onCanvasMouseUp);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) =>
    {
        // Don't trigger shortcuts when modals are open
        const buttonModal = document.getElementById('button-modal');
        const pageModal = document.getElementById('page-modal');
        if ((buttonModal && buttonModal.style.display === 'flex') || (pageModal && pageModal.style.display === 'flex'))
        {
            return; // Modal is open, don't handle shortcuts
        }

        if (e.key.toLowerCase() === 'f' && loadedImage)
        {
            fitToScreen();
        }

        if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd')
        {
            if (selectedButtonId !== null)
            {
                duplicateSelectedButton(e);
            }
            return;
        }

        // Tab key to navigate pages
        if (e.key === 'Tab')
        {
            e.preventDefault(); // Prevent default tab focus behavior
            navigatePages(e.shiftKey ? -1 : 1); // Shift+Tab goes back, Tab goes forward
        }

        // Delete key to delete selected button
        if (e.key === 'Delete')
        {
            deleteSelectedButton();
        }
    });

    // Modal
    document.getElementById('button-modal-cancel').addEventListener('click', closeButtonModal);
    document.getElementById('button-modal-save').addEventListener('click', saveButtonDetails);
    document.getElementById('button-modal-delete').addEventListener('click', deleteCurrentButton);
    document.getElementById('button-type-select').addEventListener('change', onButtonTypeChange);
    const buttonNameInput = document.getElementById('button-name-input');
    if (buttonNameInput)
    {
        buttonNameInput.addEventListener('input', () =>
        {
            if (tempButton)
            {
                tempButton.name = buttonNameInput.value;
            }
            updateButtonAppearancePanelHeading();
            refreshButtonGraphic();
        });
    }
    initializeButtonStyleControls();
    initializeButtonGraphicInteractions();

    const simpleInputSocket = document.getElementById('button-input-socket');
    if (simpleInputSocket)
    {
        // Clear button click - stop propagation to prevent input detection
        const clearBtn = simpleInputSocket.querySelector('.socket-clear-btn');
        if (clearBtn)
        {
            clearBtn.addEventListener('click', (event) =>
            {
                event.stopPropagation();
                clearSimpleButtonInput();
            });
        }

        simpleInputSocket.addEventListener('click', startInputDetection);
        simpleInputSocket.addEventListener('mouseenter', () => setButtonGraphicHoverSlot('main', simpleInputSocket));
        simpleInputSocket.addEventListener('mouseleave', clearButtonGraphicHoverSlot);
        simpleInputSocket.addEventListener('contextmenu', (event) =>
        {
            event.preventDefault();
            clearSimpleButtonInput();
        });
    }

    document.querySelectorAll('.hat-input-socket').forEach(socket =>
    {
        // Clear button click - stop propagation to prevent input detection
        const clearBtn = socket.querySelector('.socket-clear-btn');
        if (clearBtn)
        {
            clearBtn.addEventListener('click', (event) =>
            {
                event.stopPropagation();
                clearHatDirection(socket.dataset.direction);
            });
        }

        socket.addEventListener('click', () =>
        {
            startHatInputDetection(socket.dataset.direction);
        });
        socket.addEventListener('mouseenter', () => setButtonGraphicHoverSlot(socket.dataset.direction, socket));
        socket.addEventListener('mouseleave', clearButtonGraphicHoverSlot);
        socket.addEventListener('contextmenu', (event) =>
        {
            event.preventDefault();
            clearHatDirection(socket.dataset.direction);
        });
    });

    // Hidden file inputs
    // Legacy image file input - removed since per-page images are now handled in page modal
    // Keep the element for backward compatibility if needed
}

function setButtonGraphicHoverSlot(slot, socket = null)
{
    const stage = document.querySelector('.button-graphic-stage');
    if (!stage || !slot)
    {
        return;
    }

    clearButtonGraphicHoverSlot();
    stage.dataset.hoverSlot = slot;

    const targetSocket = socket || getButtonGraphicSocketForSlot(slot);
    const isFilled = Boolean(targetSocket?.classList.contains('has-value'));
    if (targetSocket)
    {
        targetSocket.classList.add('hovered-input');
        targetSocket.classList.toggle('hovered-filled', isFilled);
        targetSocket.classList.toggle('hovered-empty', !isFilled);
    }

    stage.querySelectorAll(`.button-graphic-svg .slot-${slot}`).forEach(element =>
    {
        element.classList.add('hovered-input');
        element.classList.toggle('hovered-filled', isFilled);
        element.classList.toggle('hovered-empty', !isFilled);
    });
}

function clearButtonGraphicHoverSlot()
{
    const stage = document.querySelector('.button-graphic-stage');
    if (stage)
    {
        delete stage.dataset.hoverSlot;
        stage.querySelectorAll('.button-graphic-slot.hovered-input').forEach(element =>
        {
            element.classList.remove('hovered-input', 'hovered-filled', 'hovered-empty');
        });
        stage.querySelectorAll('.button-graphic-svg .hovered-input').forEach(element =>
        {
            element.classList.remove('hovered-input', 'hovered-filled', 'hovered-empty');
        });
    }
}

function navigatePages(direction)
{
    if (!templateData.pages || templateData.pages.length === 0) return;

    const currentIndex = templateData.pages.findIndex(p => p.id === currentPageId);
    if (currentIndex === -1) return;

    const nextIndex = (currentIndex + direction + templateData.pages.length) % templateData.pages.length;
    const nextPageId = templateData.pages[nextIndex].id;

    selectPageInternal(nextPageId);
}

function selectPageInternal(pageId)
{
    if (!pageId || !Array.isArray(templateData.pages)) return;

    currentPageId = pageId;

    // Find the page and load its data
    const page = templateData.pages.find(p => p.id === pageId);
    if (page)
    {
        // Update button list to show this page's buttons
        updateButtonList();

        // Clear selection when switching pages
        selectButton(null);

        // Load the page's image (or mirrored image) - this will call redraw when done
        loadPageImage(page);
    }

    // Notify template-editor-v2 about the page change - use window.selectPage if available
    if (window.selectPage)
    {
        window.selectPage(pageId);
    }
    else if (window.templateEditorCallbacks?.onPageSelected)
    {
        window.templateEditorCallbacks.onPageSelected(pageId);
    }
}

function resizeCanvas()
{
    const container = document.getElementById('canvas-container');
    const rect = container.getBoundingClientRect();

    // Set CSS size for display (doesn't affect internal resolution)
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    // Set internal resolution to match CSS size (with device pixel ratio for crisp rendering)
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    // Note: We'll apply DPR scaling in redraw() to avoid accumulation

    console.log('Canvas resized:', rect.width, 'x', rect.height, '(DPR:', dpr + ')');

    redraw();
}

// Stick switching
function switchStick(stick, skipRedraw = false)
{
    if (currentStick === stick) return;

    // Save current camera position before switching
    if (currentStick === 'left')
    {
        leftStickCamera = { zoom, pan: { x: pan.x, y: pan.y } };
        saveCameraPosition(); // Persist to localStorage
    }
    else
    {
        rightStickCamera = { zoom, pan: { x: pan.x, y: pan.y } };
        saveCameraPosition(); // Persist to localStorage
    }

    currentStick = stick;

    console.log('Switching to stick:', stick);
    console.log('Left stick buttons:', templateData.leftStick);
    console.log('Right stick buttons:', templateData.rightStick);

    // Note: stick selector buttons removed - now using page selector dropdown
    // This function is kept for backward compatibility but no longer updates UI buttons

    // Restore saved camera position for this stick
    if (stick === 'left')
    {
        leftStickCamera = sanitizeCameraState(leftStickCamera);
        zoom = leftStickCamera.zoom;
        pan = { x: leftStickCamera.pan.x, y: leftStickCamera.pan.y };
    }
    else
    {
        rightStickCamera = sanitizeCameraState(rightStickCamera);
        zoom = rightStickCamera.zoom;
        pan = { x: rightStickCamera.pan.x, y: rightStickCamera.pan.y };
    }
    updateZoomDisplay();

    // Clear selection
    selectButton(null);

    // Update button list and redraw (unless told to skip redraw)
    updateButtonList();
    if (!skipRedraw)
    {
        redraw();
    }
}

// Get current stick's button array
function getCurrentButtons()
{
    // If using TemplateV2 pages and a page is selected, use that
    if (currentPageId && Array.isArray(templateData.pages))
    {
        const page = templateData.pages.find(p => p.id === currentPageId);
        if (page)
        {
            if (!Array.isArray(page.buttons))
            {
                page.buttons = [];
            }
            return page.buttons;
        }
    }

    // Fallback to legacy stick-based logic
    if (currentStick === 'left')
    {
        // Handle nested structure: { joystickNumber: 1, buttons: [...] }
        if (templateData.leftStick && typeof templateData.leftStick === 'object' && !Array.isArray(templateData.leftStick))
        {
            if (!Array.isArray(templateData.leftStick.buttons))
            {
                templateData.leftStick.buttons = [];
            }
            return templateData.leftStick.buttons;
        }
        // Handle flat array structure: [...]
        if (!Array.isArray(templateData.leftStick))
        {
            templateData.leftStick = [];
        }
        return templateData.leftStick;
    }
    else
    {
        // Handle nested structure: { joystickNumber: 2, buttons: [...] }
        if (templateData.rightStick && typeof templateData.rightStick === 'object' && !Array.isArray(templateData.rightStick))
        {
            if (!Array.isArray(templateData.rightStick.buttons))
            {
                templateData.rightStick.buttons = [];
            }
            return templateData.rightStick.buttons;
        }
        // Handle flat array structure: [...]
        if (!Array.isArray(templateData.rightStick))
        {
            templateData.rightStick = [];
        }
        return templateData.rightStick;
    }
}

function getCurrentStickData()
{
    // If using TemplateV2 pages and a page is selected, return that page
    if (currentPageId && Array.isArray(templateData.pages))
    {
        const page = templateData.pages.find(p => p.id === currentPageId);
        if (page)
        {
            return page;
        }
    }

    // Fallback to legacy stick data
    return currentStick === 'left' ? templateData.leftStick : templateData.rightStick;
}

// Get current page (for TemplateV2)
function getCurrentPage()
{
    if (currentPageId && Array.isArray(templateData.pages))
    {
        return templateData.pages.find(p => p.id === currentPageId);
    }
    return null;
}

function getCurrentStickJoystickNumber()
{
    const stickData = getCurrentStickData();

    // For pages with devicePrefix (v1.1+), extract the number from the prefix
    if (stickData && stickData.devicePrefix)
    {
        // Extract number from devicePrefix like "js1", "js2", "gp1", etc.
        const match = stickData.devicePrefix.match(/\d+/);
        if (match)
        {
            return parseInt(match[0], 10);
        }
    }

    // Fallback to old joystickNumber field (v1.0)
    if (stickData && stickData.joystickNumber)
    {
        return stickData.joystickNumber;
    }

    // Fallback to global joystick number
    if (templateData.joystickNumber)
    {
        return templateData.joystickNumber;
    }

    // Final fallback based on current stick
    return currentStick === 'left' ? 1 : 2;
}

function getInputDisplayInfo(button, jsNumOverride = null)
{
    const info = {
        shortLabel: null,
        fullId: null,
        type: null
    };

    if (!button)
    {
        return info;
    }

    const jsNum = jsNumOverride || getCurrentStickJoystickNumber();

    // Get current page devicePrefix (v1.1+) or device_prefix (v1.0)
    const currentPage = getCurrentPage();
    const devicePrefix = currentPage ? (currentPage.devicePrefix || currentPage.device_prefix) : null;

    const normalizePrefix = (inputString) =>
    {
        if (!inputString)
        {
            return null;
        }

        const lower = inputString.toLowerCase();

        // For v1.1+ templates with devicePrefix, prepend the prefix
        if (devicePrefix)
        {
            // If input already has a prefix, remove it first
            const withoutPrefix = lower.replace(/^(js|gp)\d+_/, '');
            return `${devicePrefix}_${withoutPrefix}`;
        }

        // For v1.0 templates, use jsNum-based prefix
        if (lower.match(/^(js|gp)\d+_/))
        {
            return lower.replace(/^(js|gp)\d+_/, `js${jsNum}_`);
        }

        // If no prefix exists, add js{jsNum}_ prefix
        return `js${jsNum}_${lower}`;
    };

    const setFromString = (inputString) =>
    {
        const normalized = normalizePrefix(inputString);
        if (!normalized)
        {
            return;
        }

        info.fullId = normalized;

        if (normalized.includes('_axis'))
        {
            info.type = 'axis';
            const axisMatch = normalized.match(/axis(\d+)(?:_(positive|negative))?/);
            if (axisMatch)
            {
                let dirSymbol = '';
                if (axisMatch[2] === 'positive')
                {
                    dirSymbol = '+';
                }
                else if (axisMatch[2] === 'negative')
                {
                    dirSymbol = '-';
                }
                else if (axisMatch[2])
                {
                    dirSymbol = axisMatch[2];
                }

                info.shortLabel = dirSymbol ? `Axis ${axisMatch[1]} ${dirSymbol}` : `Axis ${axisMatch[1]}`;
            }
            else
            {
                info.shortLabel = 'Axis';
            }
        }
        else if (normalized.match(/^(js|gp)\d+_(x|y|z|rotx|roty|rotz|slider1|slider2)$/))
        {
            // Star Citizen axis names (e.g., js1_x, js1_y, js1_rotx)
            info.type = 'axis';
            const scAxisMatch = normalized.match(/_(x|y|z|rotx|roty|rotz|slider1|slider2)$/);
            if (scAxisMatch)
            {
                const axisKey = scAxisMatch[1].toLowerCase();
                const axisName = axisKey === 'slider1' ? 'Slider 1'
                    : axisKey === 'slider2' ? 'Slider 2'
                        : axisKey.toUpperCase();
                info.shortLabel = `Axis ${axisName}`;
            }
            else
            {
                info.shortLabel = 'Axis';
            }
        }
        else if (normalized.includes('_button'))
        {
            info.type = 'button';
            const btnMatch = normalized.match(/button(\d+)/);
            info.shortLabel = btnMatch ? `Button ${btnMatch[1]}` : 'Button';
        }
        else if (normalized.includes('_hat'))
        {
            info.type = 'hat';
            const hatMatch = normalized.match(/hat(\d+)_(up|down|left|right)/);
            if (hatMatch)
            {
                const hatNum = hatMatch[1];
                const direction = hatMatch[2].charAt(0).toUpperCase() + hatMatch[2].slice(1);
                info.shortLabel = `Hat ${hatNum} ${direction}`;
            }
            else
            {
                info.shortLabel = 'Hat Switch';
            }
        }
        else
        {
            info.type = 'input';
            info.shortLabel = normalized;
        }
    };

    if (button.inputs && button.inputs.main)
    {
        if (typeof button.inputs.main === 'string')
        {
            setFromString(button.inputs.main);
        }
        else if (typeof button.inputs.main === 'object')
        {
            const main = button.inputs.main;

            if (main.type === 'axis' && main.id !== undefined)
            {
                const directionSuffix = main.direction ? `_${main.direction}` : '';
                setFromString(`js${jsNum}_axis${main.id}${directionSuffix}`);
            }
            else if (main.type === 'button' && main.id !== undefined)
            {
                setFromString(`js${jsNum}_button${main.id}`);
            }
            else if (typeof main.input === 'string')
            {
                setFromString(main.input);
            }
            else if (main.id !== undefined)
            {
                info.shortLabel = `Input ${main.id}`;
                info.fullId = main.id.toString();
            }
        }
    }
    else if (button.buttonId !== undefined && button.buttonId !== null)
    {
        setFromString(`js${jsNum}_button${button.buttonId}`);
    }
    else if (button.inputType && button.inputId !== undefined)
    {
        if (button.inputType === 'axis')
        {
            const directionSuffix = button.axisDirection ? `_${button.axisDirection}` : '';
            setFromString(`js${jsNum}_axis${button.inputId}${directionSuffix}`);
        }
        else if (button.inputType === 'button')
        {
            setFromString(`js${jsNum}_button${button.inputId}`);
        }
        else if (button.inputType === 'hat')
        {
            const hatDirection = button.hatDirection || 'up';
            setFromString(`js${jsNum}_hat${button.inputId}_${hatDirection}`);
        }
    }

    return info;
}

function formatPrettyInputLabel(inputValue, jsNumOverride = null)
{
    if (!inputValue)
    {
        return '—';
    }

    if (typeof inputValue === 'object')
    {
        if (inputValue.type === 'axis' && inputValue.id !== undefined)
        {
            const direction = inputValue.direction === 'positive'
                ? ' +'
                : inputValue.direction === 'negative'
                    ? ' -'
                    : '';
            return `Axis ${inputValue.id}${direction}`;
        }

        if (inputValue.type === 'hat' && inputValue.id !== undefined)
        {
            const direction = inputValue.direction
                ? ` ${String(inputValue.direction).charAt(0).toUpperCase()}${String(inputValue.direction).slice(1)}`
                : '';
            return `Hat ${inputValue.id}${direction}`;
        }

        if (inputValue.type === 'button' && inputValue.id !== undefined)
        {
            return `Button ${inputValue.id}`;
        }

        if (typeof inputValue.input === 'string')
        {
            return formatPrettyInputLabel(inputValue.input, jsNumOverride);
        }

        if (inputValue.id !== undefined)
        {
            return `Input ${inputValue.id}`;
        }

        return 'Input';
    }

    const displayInfo = getInputDisplayInfo({ inputs: { main: inputValue } }, jsNumOverride);
    if (displayInfo.shortLabel)
    {
        return displayInfo.shortLabel;
    }

    return String(inputValue)
        .replace(/^(js|gp)\d+_/i, '')
        .replace(/_/g, ' ')
        .replace(/([a-zA-Z])(\d)/g, '$1 $2')
        .replace(/(\d)([a-zA-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, char => char.toUpperCase());
}

function updateSimpleInputPreview(button = null)
{
    const displayInfo = getInputDisplayInfo(button);
    const socketEl = document.getElementById('button-input-socket');

    if (!socketEl)
    {
        return;
    }

    if (displayInfo.shortLabel)
    {
        const textSpan = socketEl.querySelector('.socket-text');
        if (textSpan) textSpan.textContent = displayInfo.shortLabel;
        socketEl.classList.add('has-value');
    }
    else
    {
        const textSpan = socketEl.querySelector('.socket-text');
        if (textSpan) textSpan.textContent = '—';
        socketEl.classList.remove('has-value');
    }

    refreshButtonGraphic();
}

// Set current stick's button array
function setCurrentButtons(buttons)
{
    // If using TemplateV2 pages and a page is selected, use that
    if (currentPageId && Array.isArray(templateData.pages))
    {
        const page = templateData.pages.find(p => p.id === currentPageId);
        if (page)
        {
            page.buttons = buttons;
            syncLegacyStickReferences();
            return;
        }
    }

    // Fallback to legacy stick-based logic
    if (currentStick === 'left')
    {
        // Handle nested structure
        if (templateData.leftStick && typeof templateData.leftStick === 'object' && !Array.isArray(templateData.leftStick))
        {
            templateData.leftStick.buttons = buttons;
        }
        else
        {
            templateData.leftStick = buttons;
        }
    }
    else
    {
        // Handle nested structure
        if (templateData.rightStick && typeof templateData.rightStick === 'object' && !Array.isArray(templateData.rightStick))
        {
            templateData.rightStick.buttons = buttons;
        }
        else
        {
            templateData.rightStick = buttons;
        }
    }
}

// New template
async function newTemplate()
{
    if ((templateData.name ||
        (templateData.pages && templateData.pages.length > 0) ||
        (templateData.leftStick && templateData.leftStick.buttons && templateData.leftStick.buttons.length > 0) ||
        (templateData.rightStick && templateData.rightStick.buttons && templateData.rightStick.buttons.length > 0)))
    {
        const showConfirmation = window.showConfirmation;
        if (!showConfirmation)
        {
            console.error('showConfirmation not available');
            return;
        }

        const confirmed = await showConfirmation(
            'Start a new template? Any unsaved changes will be lost.',
            'New Template',
            'Start New',
            'Cancel'
        );

        if (!confirmed)
        {
            return;
        }
    }

    // Reset all data
    templateData = {
        name: '',
        version: '1.1',
        pages: []
    };

    ensureTemplatePages();
    refreshTemplatePagesUI(templateData);

    // Reset UI
    document.getElementById('template-name').value = '';

    // Reset canvas
    loadedImage = null;
    currentStick = 'right';
    selectedButtonId = null;
    zoom = 1.0;
    pan = { x: 0, y: 0 };

    // Reset camera positions for both sticks
    leftStickCamera = { zoom: 1.0, pan: { x: 0, y: 0 } };
    rightStickCamera = { zoom: 1.0, pan: { x: 0, y: 0 } };

    // Update UI
    switchStick('right');
    resizeCanvas();

    // Clear editor-specific localStorage
    localStorage.removeItem('editorCurrentTemplate');
    localStorage.removeItem('editorTemplateFileName');
    localStorage.removeItem('editorTemplateFilePath');
    localStorage.removeItem('editorLeftStickCamera');
    localStorage.removeItem('editorRightStickCamera');
    hasUnsavedChanges = false;
    currentTemplateFilePath = null; // Clear the file path for new template
    updateTemplateUnsavedIndicator();

    // Show unsaved template indicator
    showUnsavedTemplateIndicator();

    // Reset header template name
    if (window.updateTemplateIndicator)
    {
        window.updateTemplateIndicator('Untitled Template');
    }
}

// Handle image type selection
// Legacy image loading functions removed - per-page images now handled in template page modal

// Drawing functions
function redraw()
{
    if (!ctx) return;

    // Get canvas display size
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw instructions if no pages
    if (!templateData.pages || templateData.pages.length === 0)
    {
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        ctx.save();
        ctx.scale(dpr, dpr);

        ctx.fillStyle = '#888';
        ctx.font = 'bold 24px "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.fillText('Welcome to the Template Editor', centerX, centerY - 40);

        ctx.font = '18px "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
        ctx.fillStyle = '#666';
        ctx.fillText('This template is currently empty.', centerX, centerY);
        ctx.fillText('Click "Add Device" in the sidebar to add your first joystick or gamepad.', centerX, centerY + 30);

        ctx.restore();
        return;
    }

    // Determine if image should be flipped (page-based mirroring only)
    let shouldFlip = false;
    const currentPage = getCurrentPage();
    if (currentPage)
    {
        // Check if this page mirrors another page (flip required)
        shouldFlip = !!currentPage.mirror_from_page_id;
    }

    ctx.save();

    // Apply DPR scaling first (to work with physical pixels)
    ctx.scale(dpr, dpr);

    // Apply zoom and pan (in logical pixels)
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw image if available
    if (loadedImage)
    {
        // Enable smooth image rendering
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Draw image with optional flip based on mirroring settings
        ctx.save();

        if (shouldFlip)
        {
            ctx.translate(loadedImage.width, 0);
            ctx.scale(-1, 1);
        }
        ctx.drawImage(loadedImage, 0, 0);
        ctx.restore();
    }
    else if (currentPage)
    {
        // Draw placeholder if page exists but no image is loaded
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        // We are already inside ctx.save() with dpr scaling, but also zoom/pan
        // For instructions we might want them fixed or relative to the "image area"
        // Let's draw them relative to the viewport for now if no image

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Reset to just DPR scaling

        ctx.fillStyle = '#555';
        ctx.font = 'bold 20px "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';

        ctx.fillText(`Device: ${currentPage.name || 'Untitled'}`, centerX, centerY - 20);
        ctx.font = '16px "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
        ctx.fillStyle = '#777';
        ctx.fillText('No background image loaded for this device.', centerX, centerY + 15);
        ctx.fillText('You can still place buttons, or add an image in Device Settings.', centerX, centerY + 40);

        ctx.restore();
    }

    // Draw all buttons for current stick (without flip)
    // This works even if there's no background image
    const buttons = getButtonsInDrawOrder();
    if (Array.isArray(buttons))
    {
        // First pass: draw all connecting lines
        buttons.forEach(button =>
        {
            if (button.labelPos)
            {
                drawConnectingLineOnly(button);
            }
        });

        // Second pass: draw all buttons/markers/labels
        buttons.forEach(button =>
        {
            drawButton(button);
        });
    }

    // Draw temp button while placing
    if (tempButton)
    {
        drawPlacementPreview();
        drawButton(tempButton, true);
    }

    ctx.restore();
}

// Expose redraw globally for use by template-editor-v2.js
window.redraw = redraw;

// Expose function to update loadedImage from external modules
window.setLoadedImage = function (img)
{
    loadedImage = img;
};

function drawPlacementPreview()
{
    if (mode !== 'placing-label' || !tempButton?.buttonPos || !placementPreviewPos)
    {
        return;
    }

    const previewButton = {
        ...tempButton,
        labelPos: placementPreviewPos
    };
    const accentPrimary = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim();
    const frameWidth = getButtonFrameWidth(previewButton, ButtonFrameWidth);
    const frameHeight = getButtonFrameHeight(previewButton, ButtonFrameHeight);
    const frameX = placementPreviewPos.x - frameWidth / 2;
    const frameY = placementPreviewPos.y - frameHeight / 2;

    ctx.save();
    ctx.globalAlpha = 0.72;
    drawConnectingLine(ctx, previewButton.buttonPos, previewButton.labelPos, frameWidth / 2, accentPrimary, false);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = 'rgba(34, 34, 34, 0.56)';
    ctx.strokeStyle = accentPrimary;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);
    roundRect(ctx, frameX, frameY, frameWidth, frameHeight, 4);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
}

// Helper function to draw only the connecting line for a button
function drawConnectingLineOnly(button)
{
    const isMultiInput = button.buttonType && (
        button.buttonType.startsWith('hat') ||
        button.buttonType === 'toggle3way-vertical' ||
        button.buttonType === 'toggle3way-horizontal' ||
        button.buttonType === 'rotary3way' ||
        button.buttonType === 'rotary4way'
    );
    const alpha = 1.0; // Full opacity for lines in first pass

    ctx.save();
    ctx.globalAlpha = alpha;

    // Get CSS variable colors
    const accentPrimary = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim();
    const bgLight = getComputedStyle(document.documentElement).getPropertyValue('--bg-light').trim();

    let lineColor = accentPrimary; // Default to accent primary color

    if (isMultiInput)
    {
        // For multi-input controls, check if at least some directions are bound
        let hasBoundDirections = false;
        if (button.buttonType === 'hat4way')
        {
            hasBoundDirections = button.inputs &&
                button.inputs.up &&
                button.inputs.down &&
                button.inputs.left &&
                button.inputs.right;
        }
        else if (button.buttonType === 'hat2way-vertical')
        {
            hasBoundDirections = button.inputs && button.inputs.up && button.inputs.down;
        }
        else if (button.buttonType === 'hat2way-horizontal')
        {
            hasBoundDirections = button.inputs && button.inputs.left && button.inputs.right;
        }
        else if (button.buttonType === 'toggle3way-vertical')
        {
            hasBoundDirections = button.inputs && button.inputs.up && button.inputs.middle && button.inputs.down;
        }
        else if (button.buttonType === 'toggle3way-horizontal')
        {
            hasBoundDirections = button.inputs && button.inputs.left && button.inputs.middle && button.inputs.right;
        }
        else if (button.buttonType === 'rotary3way')
        {
            hasBoundDirections = button.inputs && button.inputs['1'] && button.inputs['2'] && button.inputs['3'];
        }
        else if (button.buttonType === 'rotary4way')
        {
            hasBoundDirections = button.inputs && button.inputs['1'] && button.inputs['2'] && button.inputs['3'] && button.inputs['4'];
        }

        lineColor = hasBoundDirections ? accentPrimary : bgLight;
    }

    // Use shared drawConnectingLine function
    // Note: Need to scale offset for zoom level in template editor
    const labelWidth = isMultiInput ? 0 : getButtonFrameWidth(button);
    drawConnectingLine(ctx, button.buttonPos, button.labelPos, labelWidth / 2, lineColor, isMultiInput);
    ctx.restore();
}

function drawButton(button, isTemp = false)
{
    const alpha = isTemp ? 0.7 : 1.0;
    const isMultiInput = button.buttonType && (
        button.buttonType.startsWith('hat') ||
        button.buttonType === 'toggle3way-vertical' ||
        button.buttonType === 'toggle3way-horizontal' ||
        button.buttonType === 'rotary3way' ||
        button.buttonType === 'rotary4way'
    );

    // Note: Lines are now drawn in a separate pass before this function is called
    // This ensures button frames are always drawn on top of lines

    // Draw button position marker using shared function
    ctx.save();
    ctx.globalAlpha = alpha;
    const isSelected = selectedButtonId !== null && String(button.id) === String(selectedButtonId);
    drawButtonMarker(ctx, button.buttonPos, zoom, !isMultiInput, isMultiInput, isSelected);
    ctx.restore();

    // Draw label box(es) using shared functions
    if (button.labelPos)
    {
        if (button.buttonType === 'hat4way')
        {
            drawHat4WayFrames(ctx, button, alpha, (7 / zoom), zoom);
        }
        else if (button.buttonType === 'hat2way-vertical')
        {
            drawHat2WayVerticalBoxes(ctx, button, {
                mode: 'template',
                alpha: alpha,
                isTemplateEditor: true,
                getContentForDirection: (dir, input) =>
                {
                    const contentLines = [];
                    const match = input.match(/button(\d+)/i);
                    if (match)
                    {
                        contentLines.push(`[subtle]Button ${match[1]}`);
                    }
                    return contentLines;
                },
                colors: {
                    titleColor: '#aaa',
                    contentColor: '#ddd',
                    subtleColor: '#999',
                    mutedColor: '#666',
                    boxColor: getButtonBoxColor(button)
                },
                hatFrameWidth: getButtonFrameWidth(button, HatFrameWidth),
                hatFrameHeight: getButtonFrameHeight(button, HatFrameHeight)
            });
        }
        else if (button.buttonType === 'hat2way-horizontal')
        {
            drawHat2WayHorizontalBoxes(ctx, button, {
                mode: 'template',
                alpha: alpha,
                isTemplateEditor: true,
                getContentForDirection: (dir, input) =>
                {
                    const contentLines = [];
                    const match = input.match(/button(\d+)/i);
                    if (match)
                    {
                        contentLines.push(`[subtle]Button ${match[1]}`);
                    }
                    return contentLines;
                },
                colors: {
                    titleColor: '#aaa',
                    contentColor: '#ddd',
                    subtleColor: '#999',
                    mutedColor: '#666',
                    boxColor: getButtonBoxColor(button)
                },
                hatFrameWidth: getButtonFrameWidth(button, HatFrameWidth),
                hatFrameHeight: getButtonFrameHeight(button, HatFrameHeight)
            });
        }
        else if (button.buttonType === 'toggle3way-vertical')
        {
            drawToggle3WayBoxes(ctx, button, {
                mode: 'template',
                alpha,
                orientation: 'vertical',
                isTemplateEditor: true,
                getContentForDirection: (dir, input) =>
                {
                    const contentLines = [];
                    const match = String(input).match(/button(\d+)/i);
                    if (match)
                    {
                        contentLines.push(`[subtle]Button ${match[1]}`);
                    }
                    return contentLines;
                },
                colors: {
                    titleColor: '#aaa',
                    contentColor: '#ddd',
                    subtleColor: '#999',
                    mutedColor: '#666',
                    boxColor: getButtonBoxColor(button)
                },
                hatFrameWidth: getButtonFrameWidth(button, HatFrameWidth),
                hatFrameHeight: getButtonFrameHeight(button, HatFrameHeight)
            });
        }
        else if (button.buttonType === 'toggle3way-horizontal')
        {
            drawToggle3WayBoxes(ctx, button, {
                mode: 'template',
                alpha,
                orientation: 'horizontal',
                isTemplateEditor: true,
                getContentForDirection: (dir, input) =>
                {
                    const contentLines = [];
                    const match = String(input).match(/button(\d+)/i);
                    if (match)
                    {
                        contentLines.push(`[subtle]Button ${match[1]}`);
                    }
                    return contentLines;
                },
                colors: {
                    titleColor: '#aaa',
                    contentColor: '#ddd',
                    subtleColor: '#999',
                    mutedColor: '#666',
                    boxColor: getButtonBoxColor(button)
                },
                hatFrameWidth: getButtonFrameWidth(button, HatFrameWidth),
                hatFrameHeight: getButtonFrameHeight(button, HatFrameHeight)
            });
        }
        else if (button.buttonType === 'rotary3way')
        {
            drawRotaryBoxes(ctx, button, {
                mode: 'template',
                alpha,
                steps: 3,
                includePush: true,
                isTemplateEditor: true,
                getContentForDirection: (dir, input) =>
                {
                    const contentLines = [];
                    const match = String(input).match(/button(\d+)/i);
                    if (match)
                    {
                        contentLines.push(`[subtle]Button ${match[1]}`);
                    }
                    return contentLines;
                },
                colors: {
                    titleColor: '#aaa',
                    contentColor: '#ddd',
                    subtleColor: '#999',
                    mutedColor: '#666',
                    boxColor: getButtonBoxColor(button)
                },
                hatFrameWidth: getButtonFrameWidth(button, HatFrameWidth),
                hatFrameHeight: getButtonFrameHeight(button, HatFrameHeight)
            });
        }
        else if (button.buttonType === 'rotary4way')
        {
            drawRotaryBoxes(ctx, button, {
                mode: 'template',
                alpha,
                steps: 4,
                includePush: true,
                isTemplateEditor: true,
                getContentForDirection: (dir, input) =>
                {
                    const contentLines = [];
                    const match = String(input).match(/button(\d+)/i);
                    if (match)
                    {
                        contentLines.push(`[subtle]Button ${match[1]}`);
                    }
                    return contentLines;
                },
                colors: {
                    titleColor: '#aaa',
                    contentColor: '#ddd',
                    subtleColor: '#999',
                    mutedColor: '#666',
                    boxColor: getButtonBoxColor(button)
                },
                hatFrameWidth: getButtonFrameWidth(button, HatFrameWidth),
                hatFrameHeight: getButtonFrameHeight(button, HatFrameHeight)
            });
        }
        else
        {
            drawSingleButtonLabel(ctx, button, alpha, true);
        }
    }

    // Highlight if selected
    if (isSelected && !isTemp)
    {
        ctx.save();
        const accentPrimary = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim();
        ctx.strokeStyle = accentPrimary;
        ctx.lineWidth = 3;

        // Explicitly highlight selected button marker so selected singular buttons
        // always show a themed border on the marker itself.
        const markerRadius = isMultiInput ? 6 : (7 / zoom);
        ctx.beginPath();
        ctx.arc(button.buttonPos.x, button.buttonPos.y, markerRadius + (2 / zoom), 0, Math.PI * 2);
        ctx.stroke();

        // Highlight the connecting line with hover color
        if (button.labelPos)
        {
            const isMultiInput = button.buttonType && (
                button.buttonType.startsWith('hat') ||
                button.buttonType === 'toggle3way-vertical' ||
                button.buttonType === 'toggle3way-horizontal' ||
                button.buttonType === 'rotary3way' ||
                button.buttonType === 'rotary4way'
            );
            drawConnectingLine(ctx, button.buttonPos, button.labelPos, isMultiInput ? 0 : getButtonFrameWidth(button) / 2, accentPrimary, isMultiInput);
        }

        // Highlight the label box border
        if (button.labelPos)
        {
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = accentPrimary;
            const isMultiInput = button.buttonType && (
                button.buttonType.startsWith('hat') ||
                button.buttonType === 'toggle3way-vertical' ||
                button.buttonType === 'toggle3way-horizontal' ||
                button.buttonType === 'rotary3way' ||
                button.buttonType === 'rotary4way'
            );

            if (isMultiInput)
            {
                const groupBounds = getGroupedFrameBounds(button);
                if (groupBounds)
                {
                    roundRect(ctx, groupBounds.x, groupBounds.y, groupBounds.width, groupBounds.height, 6);
                    ctx.stroke();
                }
            }
            else
            {
                // For simple buttons, highlight the label box
                const labelWidth = getButtonFrameWidth(button);
                const labelHeight = getButtonFrameHeight(button, ButtonFrameHeight);
                const x = button.labelPos.x - labelWidth / 2;
                const y = button.labelPos.y - labelHeight / 2;

                roundRect(ctx, x, y, labelWidth, labelHeight, 4);
                ctx.stroke();
            }
        }

        ctx.restore();
    }
}

function getGroupedFrameBounds(button)
{
    if (!button || !button.labelPos)
    {
        return null;
    }

    const frames = [];
    const frameWidth = getButtonFrameWidth(button, HatFrameWidth);
    const frameHeight = getButtonFrameHeight(button, HatFrameHeight);
    const addFrame = (centerPos, width = frameWidth, height = frameHeight) =>
    {
        if (!centerPos)
        {
            return;
        }
        frames.push({
            x: centerPos.x - width / 2,
            y: centerPos.y - height / 2,
            width,
            height
        });
    };

    if (button.buttonType === 'hat4way')
    {
        const hasPush = !!button.inputs?.push;
        const positions = getHat4WayPositions(button.labelPos.x, button.labelPos.y, hasPush, frameWidth, frameHeight);
        ['up', 'down', 'left', 'right', 'push'].forEach(dir =>
        {
            if (button.inputs && button.inputs[dir])
            {
                addFrame(positions[dir]);
            }
        });
    }
    else if (button.buttonType === 'hat2way-vertical')
    {
        const hasPush = !!button.inputs?.push;
        const positions = getHat2WayVerticalPositions(button.labelPos.x, button.labelPos.y, hasPush, frameWidth, frameHeight);
        ['up', 'down', 'push'].forEach(dir =>
        {
            if (button.inputs && button.inputs[dir])
            {
                addFrame(positions[dir]);
            }
        });
    }
    else if (button.buttonType === 'hat2way-horizontal')
    {
        const hasPush = !!button.inputs?.push;
        const positions = getHat2WayHorizontalPositions(button.labelPos.x, button.labelPos.y, hasPush, frameWidth, frameHeight);
        ['left', 'right', 'push'].forEach(dir =>
        {
            if (button.inputs && button.inputs[dir])
            {
                addFrame(positions[dir]);
            }
        });
    }
    else if (button.buttonType === 'toggle3way-vertical')
    {
        const positions = getToggle3WayPositions(button.labelPos.x, button.labelPos.y, 'vertical', frameWidth, frameHeight);
        ['up', 'middle', 'down'].forEach(dir => addFrame(positions[dir]));
    }
    else if (button.buttonType === 'toggle3way-horizontal')
    {
        const positions = getToggle3WayPositions(button.labelPos.x, button.labelPos.y, 'horizontal', frameWidth, frameHeight);
        ['left', 'middle', 'right'].forEach(dir => addFrame(positions[dir]));
    }
    else if (button.buttonType === 'rotary3way')
    {
        const hasPush = !!button.inputs?.push;
        const positions = getRotaryPositions(button.labelPos.x, button.labelPos.y, 3, hasPush, frameWidth, frameHeight);
        ['1', '2', '3'].forEach(dir => addFrame(positions[dir]));
        if (hasPush)
        {
            addFrame(positions.push);
        }
    }
    else if (button.buttonType === 'rotary4way')
    {
        const hasPush = !!button.inputs?.push;
        const positions = getRotaryPositions(button.labelPos.x, button.labelPos.y, 4, hasPush, frameWidth, frameHeight);
        ['1', '2', '3', '4'].forEach(dir => addFrame(positions[dir]));
        if (hasPush)
        {
            addFrame(positions.push);
        }
    }

    if (frames.length === 0)
    {
        return null;
    }

    const minX = Math.min(...frames.map(frame => frame.x));
    const minY = Math.min(...frames.map(frame => frame.y));
    const maxX = Math.max(...frames.map(frame => frame.x + frame.width));
    const maxY = Math.max(...frames.map(frame => frame.y + frame.height));
    const padding = 6;

    return {
        x: minX - padding,
        y: minY - padding,
        width: (maxX - minX) + (padding * 2),
        height: (maxY - minY) + (padding * 2)
    };
}

// Note: drawSingleButtonLabel and drawHat4WayLabels are now imported from button-renderer.js
// Note: roundRect and simplifyButtonName are now imported from button-renderer.js

// Canvas interaction
function getCanvasCoords(event)
{
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left - pan.x) / zoom;
    const y = (event.clientY - rect.top - pan.y) / zoom;
    return { x, y };
}

function onCanvasMouseDown(event)
{
    const coords = getCanvasCoords(event);

    // Middle click or right click for panning
    if (event.button === 1 || event.button === 2)
    {
        isPanning = true;
        lastPanPosition = { x: event.clientX, y: event.clientY };
        canvas.style.cursor = 'grabbing';
        event.preventDefault();
        return;
    }

    // Only handle left click for button operations below this point
    if (event.button !== 0) return;

    if (mode === 'view')
    {
        // Can select buttons even without an image for reference
        // Check if clicking on a handle
        const handle = findHandleAtPosition(coords);
        if (handle)
        {
            const buttons = getCurrentButtons();
            const button = buttons.find(b => b.id === handle.buttonId);
            if (button)
            {
                const targetPos = handle.type === 'button' ? button.buttonPos : button.labelPos;
                handle.offsetX = coords.x - targetPos.x;
                handle.offsetY = coords.y - targetPos.y;
            }
            draggingHandle = handle;
            selectButton(handle.buttonId);
            return;
        }

        // Check if clicking on a button
        const button = findButtonAtPosition(coords);
        if (button)
        {
            selectButton(button.id);
        } else
        {
            selectButton(null);
        }
    } else if (mode === 'placing-button')
    {
        // Place the button position
        tempButton = {
            id: Date.now(),
            name: '',
            buttonPos: { ...coords },
            labelPos: null
        };
        placementPreviewPos = { ...coords };
        mode = 'placing-label';
        redraw();
    } else if (mode === 'placing-label')
    {
        // Place the label position
        tempButton.labelPos = { ...coords };
        placementPreviewPos = null;
        mode = 'view';
        redraw();

        // Open modal to get button name
        openButtonModal(tempButton);
    }
}

// Snap coordinate to grid
function snapToGrid(value, gridSize = SNAP_GRID)
{
    return Math.round(value / gridSize) * gridSize;
}

function onCanvasMouseMove(event)
{
    if (isPanning)
    {
        const deltaX = event.clientX - lastPanPosition.x;
        const deltaY = event.clientY - lastPanPosition.y;

        pan.x += deltaX;
        pan.y += deltaY;

        lastPanPosition = { x: event.clientX, y: event.clientY };
        redraw();
        return;
    }

    if (draggingHandle)
    {
        const coords = getCanvasCoords(event);
        // Apply offset to prevent jumping to mouse cursor
        const targetX = coords.x - (draggingHandle.offsetX || 0);
        const targetY = coords.y - (draggingHandle.offsetY || 0);

        const snappedCoords = {
            x: snapToGrid(targetX),
            y: snapToGrid(targetY)
        };
        const buttons = getCurrentButtons();
        const button = buttons.find(b => b.id === draggingHandle.buttonId);

        if (button)
        {
            if (draggingHandle.type === 'button')
            {
                button.buttonPos = { ...snappedCoords };
            } else if (draggingHandle.type === 'label')
            {
                button.labelPos = { ...snappedCoords };
            }
            markAsChanged();
            redraw();
        }
    }

    if (mode === 'placing-label' && tempButton)
    {
        placementPreviewPos = getCanvasCoords(event);
        canvas.style.cursor = 'crosshair';
        redraw();
        return;
    }

    // Update cursor
    if (mode === 'placing-button' || mode === 'placing-label')
    {
        canvas.style.cursor = 'crosshair';
    } else if (draggingHandle)
    {
        canvas.style.cursor = 'move';
    } else
    {
        const coords = getCanvasCoords(event);
        const handle = findHandleAtPosition(coords);
        canvas.style.cursor = handle ? 'move' : 'default';
    }
}

function onCanvasMouseUp(event)
{
    if (isPanning)
    {
        isPanning = false;
        canvas.style.cursor = 'default';
        // Save camera position after panning
        saveCameraPosition();
    }

    draggingHandle = null;
}

// Helper function to save current camera position
function saveCameraPosition()
{
    if (currentStick === 'left')
    {
        leftStickCamera = { zoom, pan: { x: pan.x, y: pan.y } };
        localStorage.setItem('editorLeftStickCamera', JSON.stringify(leftStickCamera));
    }
    else
    {
        rightStickCamera = { zoom, pan: { x: pan.x, y: pan.y } };
        localStorage.setItem('editorRightStickCamera', JSON.stringify(rightStickCamera));
    }
}

function onCanvasWheel(event)
{
    event.preventDefault();

    const delta = -event.deltaY / 1000;
    zoomBy(delta, event);
}

function onCanvasDoubleClick(event)
{
    // Allow editing even if no image is loaded, as long as we are in view mode
    if (mode !== 'view') return;

    const coords = getCanvasCoords(event);
    console.log('Double click at', coords);

    // Check if double-clicking on a button
    const button = findButtonAtPosition(coords);
    if (button)
    {
        console.log('Found button', button.id);
        editButtonFromList(button.id);
    }
    else
    {
        console.log('No button found at position');
    }
}

function findHandleAtPosition(pos)
{
    const handleSize = 12 / zoom; // For button position markers
    const buttons = getButtonsInHitTestOrder();

    for (const button of buttons)
    {
        // Check button position handle (keep the red dot)
        const distButton = Math.sqrt(
            Math.pow(pos.x - button.buttonPos.x, 2) +
            Math.pow(pos.y - button.buttonPos.y, 2)
        );
        if (distButton <= handleSize)
        {
            return { buttonId: button.id, type: 'button' };
        }

        // Check if clicking on label box area
        if (button.labelPos)
        {
            const isHat = button.buttonType && button.buttonType.startsWith('hat');

            if (isHat)
            {
                // Use centralized hat position calculation
                const hasPush = button.inputs && button.inputs['push'];
                let directions, getBoundsFn;

                if (button.buttonType === 'hat4way')
                {
                    directions = ['up', 'down', 'left', 'right', 'push'];
                    getBoundsFn = getHat4WayBoxBounds;
                }
                else if (button.buttonType === 'hat2way-vertical')
                {
                    directions = ['up', 'down', 'push'];
                    getBoundsFn = getHat2WayVerticalBoxBounds;
                }
                else if (button.buttonType === 'hat2way-horizontal')
                {
                    directions = ['left', 'right', 'push'];
                    getBoundsFn = getHat2WayHorizontalBoxBounds;
                }

                for (const dir of directions)
                {
                    // Only check directions that have inputs
                    if (!button.inputs || !button.inputs[dir])
                    {
                        continue;
                    }

                    const bounds = getBoundsFn(dir, button.labelPos.x, button.labelPos.y, hasPush);
                    if (bounds &&
                        pos.x >= bounds.x && pos.x <= bounds.x + bounds.width &&
                        pos.y >= bounds.y && pos.y <= bounds.y + bounds.height)
                    {
                        return { buttonId: button.id, type: 'label' };
                    }
                }
            }
            else
            {
                // For simple buttons, check the single label box
                // Use world coordinates (don't divide by zoom)
                const labelWidth = getButtonFrameWidth(button);
                const labelHeight = getButtonFrameHeight(button, ButtonFrameHeight);
                const x = button.labelPos.x - labelWidth / 2;
                const y = button.labelPos.y - labelHeight / 2;

                if (pos.x >= x && pos.x <= x + labelWidth &&
                    pos.y >= y && pos.y <= y + labelHeight)
                {
                    return { buttonId: button.id, type: 'label' };
                }
            }
        }
    }

    return null;
}

function findButtonAtPosition(pos)
{
    const handleSize = 12 / zoom;
    const buttons = getButtonsInHitTestOrder();

    for (const button of buttons)
    {
        // Check if clicking near button position
        const dist = Math.sqrt(
            Math.pow(pos.x - button.buttonPos.x, 2) +
            Math.pow(pos.y - button.buttonPos.y, 2)
        );
        if (dist <= handleSize)
        {
            return button;
        }

        // Check if clicking on label box
        if (button.labelPos)
        {
            if (button.buttonType && button.buttonType.startsWith('hat'))
            {
                const hasPush = button.inputs && button.inputs['push'];
                const frameWidth = getButtonFrameWidth(button, HatFrameWidth);
                const frameHeight = getButtonFrameHeight(button, HatFrameHeight);
                let directions, getBoundsFn;

                if (button.buttonType === 'hat4way')
                {
                    directions = ['up', 'down', 'left', 'right', 'push'];
                    getBoundsFn = getHat4WayBoxBounds;
                }
                else if (button.buttonType === 'hat2way-vertical')
                {
                    directions = ['up', 'down', 'push'];
                    getBoundsFn = getHat2WayVerticalBoxBounds;
                }
                else if (button.buttonType === 'hat2way-horizontal')
                {
                    directions = ['left', 'right', 'push'];
                    getBoundsFn = getHat2WayHorizontalBoxBounds;
                }

                for (const dir of directions)
                {
                    // Only check directions that have inputs
                    if (!button.inputs || !button.inputs[dir])
                    {
                        continue;
                    }

                    const bounds = getBoundsFn(dir, button.labelPos.x, button.labelPos.y, hasPush, frameWidth, frameHeight);
                    if (bounds &&
                        pos.x >= bounds.x && pos.x <= bounds.x + bounds.width &&
                        pos.y >= bounds.y && pos.y <= bounds.y + bounds.height)
                    {
                        return button;
                    }
                }
            }
            else
            {
                const labelWidth = getButtonFrameWidth(button);
                const labelHeight = getButtonFrameHeight(button, ButtonFrameHeight);
                const x = button.labelPos.x - labelWidth / 2;
                const y = button.labelPos.y - labelHeight / 2;

                if (pos.x >= x && pos.x <= x + labelWidth &&
                    pos.y >= y && pos.y <= y + labelHeight)
                {
                    return button;
                }
            }
        }
    }

    return null;
}

// Zoom functions
function zoomBy(delta, event = null)
{
    const oldZoom = zoom;
    zoom = Math.max(0.1, Math.min(5, zoom + delta));

    if (event)
    {
        // Zoom towards mouse position
        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        pan.x = mouseX - (mouseX - pan.x) * (zoom / oldZoom);
        pan.y = mouseY - (mouseY - pan.y) * (zoom / oldZoom);
    }

    updateZoomDisplay();
    saveCameraPosition();
    redraw();
}

function resetZoom()
{
    if (!loadedImage) return;

    const viewport = getCanvasViewportSize();

    // Reset to 100% zoom
    zoom = 1.0;

    // Center image in canvas at actual size
    const scaledWidth = loadedImage.width * zoom;
    const scaledHeight = loadedImage.height * zoom;
    pan.x = (viewport.width - scaledWidth) / 2;
    pan.y = (viewport.height - scaledHeight) / 2;

    updateZoomDisplay();
    saveCameraPosition();
    redraw();
}

function getCanvasViewportBounds()
{
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const panel = canvas.closest('.editor-panel');
    const margin = 16;
    let top = rect.top;
    let bottom = rect.bottom;

    const getVisibleRect = (selector) =>
    {
        const element = panel?.querySelector(selector);
        if (!element)
        {
            return null;
        }

        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden')
        {
            return null;
        }

        const elementRect = element.getBoundingClientRect();
        const overlapsCanvas = elementRect.right > rect.left &&
            elementRect.left < rect.right &&
            elementRect.bottom > rect.top &&
            elementRect.top < rect.bottom;

        return overlapsCanvas ? elementRect : null;
    };

    const toolbarRect = getVisibleRect('.template-controls-panel');
    if (toolbarRect)
    {
        top = Math.max(top, Math.min(rect.bottom, toolbarRect.bottom + margin));
    }

    const editControlsRect = getVisibleRect('.edit-controls');
    if (editControlsRect)
    {
        bottom = Math.min(bottom, Math.max(rect.top, editControlsRect.top - margin));
    }

    const zoomControlsRect = getVisibleRect('.zoom-controls');
    if (zoomControlsRect)
    {
        bottom = Math.min(bottom, Math.max(rect.top, zoomControlsRect.top - margin));
    }

    const width = rect.width || (canvas.width / dpr);
    const height = Math.max(0, bottom - top) || Math.max(0, rect.height) || (canvas.height / dpr);

    return {
        left: 0,
        top: top - rect.top,
        right: width,
        bottom: (top - rect.top) + height,
        width,
        height,
        centerX: width / 2,
        centerY: (top - rect.top) + (height / 2)
    };
}

function getCanvasViewportSize()
{
    const viewportBounds = getCanvasViewportBounds();
    return {
        width: viewportBounds.width,
        height: viewportBounds.height
    };
}

function toFiniteNumber(value)
{
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

function sanitizeCameraState(camera)
{
    const safeZoom = toFiniteNumber(camera?.zoom);
    const safePanX = toFiniteNumber(camera?.pan?.x);
    const safePanY = toFiniteNumber(camera?.pan?.y);

    return {
        zoom: safeZoom !== null && safeZoom > 0 ? safeZoom : 1.0,
        pan: {
            x: safePanX ?? 0,
            y: safePanY ?? 0
        }
    };
}

function isValidWorldBounds(bounds)
{
    return Boolean(bounds) &&
        Number.isFinite(bounds.minX) &&
        Number.isFinite(bounds.minY) &&
        Number.isFinite(bounds.maxX) &&
        Number.isFinite(bounds.maxY) &&
        bounds.maxX >= bounds.minX &&
        bounds.maxY >= bounds.minY;
}

function expandWorldBounds(bounds, rect)
{
    if (!rect ||
        !Number.isFinite(rect.x) ||
        !Number.isFinite(rect.y) ||
        !Number.isFinite(rect.width) ||
        !Number.isFinite(rect.height) ||
        rect.width < 0 ||
        rect.height < 0)
    {
        return bounds;
    }

    if (!bounds)
    {
        return {
            minX: rect.x,
            minY: rect.y,
            maxX: rect.x + rect.width,
            maxY: rect.y + rect.height
        };
    }

    bounds.minX = Math.min(bounds.minX, rect.x);
    bounds.minY = Math.min(bounds.minY, rect.y);
    bounds.maxX = Math.max(bounds.maxX, rect.x + rect.width);
    bounds.maxY = Math.max(bounds.maxY, rect.y + rect.height);
    return bounds;
}

function getFrameRect(centerX, centerY, width, height)
{
    const safeCenterX = toFiniteNumber(centerX);
    const safeCenterY = toFiniteNumber(centerY);
    const safeWidth = toFiniteNumber(width);
    const safeHeight = toFiniteNumber(height);

    if (safeCenterX === null || safeCenterY === null || safeWidth === null || safeHeight === null || safeWidth < 0 || safeHeight < 0)
    {
        return null;
    }

    return {
        x: safeCenterX - (safeWidth / 2),
        y: safeCenterY - (safeHeight / 2),
        width: safeWidth,
        height: safeHeight
    };
}

function getButtonVisualBounds(button)
{
    if (!button)
    {
        return null;
    }

    let bounds = null;
    const labelPosX = toFiniteNumber(button.labelPos?.x);
    const labelPosY = toFiniteNumber(button.labelPos?.y);
    const isMultiInput = button.buttonType && (
        button.buttonType.startsWith('hat') ||
        button.buttonType === 'toggle3way-vertical' ||
        button.buttonType === 'toggle3way-horizontal' ||
        button.buttonType === 'rotary3way' ||
        button.buttonType === 'rotary4way'
    );
    const markerRadius = isMultiInput ? 6 : 7;

    if (button.buttonPos)
    {
        bounds = expandWorldBounds(bounds, getFrameRect(button.buttonPos.x, button.buttonPos.y, markerRadius * 2, markerRadius * 2));
    }

    if (labelPosX === null || labelPosY === null)
    {
        return bounds;
    }

    const groupedFrameBounds = getGroupedFrameBounds(button);
    if (groupedFrameBounds)
    {
        return expandWorldBounds(bounds, groupedFrameBounds);
    }

    bounds = expandWorldBounds(bounds, getFrameRect(
        labelPosX,
        labelPosY,
        getButtonFrameWidth(button),
        getButtonFrameHeight(button, ButtonFrameHeight)
    ));

    return bounds;
}

function getFitContentBounds()
{
    let bounds = null;

    for (const button of getCurrentButtons())
    {
        bounds = expandWorldBounds(bounds, getButtonVisualBounds(button));
    }

    if (isValidWorldBounds(bounds))
    {
        return bounds;
    }

    if (loadedImage)
    {
        return {
            minX: 0,
            minY: 0,
            maxX: loadedImage.width,
            maxY: loadedImage.height
        };
    }

    return null;
}

function fitToScreen()
{
    const bounds = getFitContentBounds();
    if (!bounds) return;

    const viewport = getCanvasViewportBounds();
    if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0)
    {
        return;
    }

    // Fit button frames within the visible canvas with a little breathing room.
    const padding = 146;
    const availableWidth = Math.max(1, viewport.width - (padding * 2));
    const availableHeight = Math.max(1, viewport.height - (padding * 2));
    const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
    const contentHeight = Math.max(1, bounds.maxY - bounds.minY);

    const scaleX = availableWidth / contentWidth;
    const scaleY = availableHeight / contentHeight;
    const nextZoom = Math.min(scaleX, scaleY);

    if (!Number.isFinite(nextZoom) || nextZoom <= 0)
    {
        return;
    }

    zoom = nextZoom;

    // Clamp zoom to reasonable bounds
    zoom = Math.max(0.1, Math.min(5, zoom));

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const nextPanX = viewport.centerX - (centerX * zoom);
    const nextPanY = viewport.centerY - (centerY * zoom);

    if (!Number.isFinite(nextPanX) || !Number.isFinite(nextPanY))
    {
        return;
    }

    pan.x = nextPanX;
    pan.y = nextPanY;

    updateZoomDisplay();
    saveCameraPosition();
    redraw();
}

function updateZoomDisplay()
{
    const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1.0;
    if (zoom !== safeZoom)
    {
        zoom = safeZoom;
    }

    document.getElementById('zoom-level').textContent = `${Math.round(safeZoom * 100)}%`;
}

// Button management
async function startAddButton()
{
    // Get the current page and its device configuration
    const currentPage = getCurrentPage();
    if (!currentPage)
    {
        const showAlert = window.showAlert || alert;
        await showAlert('Please select or create a page first before adding buttons.', 'No Page Selected');
        return;
    }

    // Check if device prefix is configured (required for button input mapping)
    const devicePrefix = currentPage.device_prefix || currentPage.devicePrefix;
    if (!devicePrefix)
    {
        const showAlert = window.showAlert || alert;
        await showAlert(
            `Please configure a device prefix for the "${currentPage.name || 'Untitled Page'}" page first.\n\n` +
            `Click the "Edit" button on the page, then select a device prefix (e.g., js1, js2, etc.) and save.`,
            'Configure Device Prefix First'
        );
        return;
    }

    mode = 'placing-button';
    placementPreviewPos = null;
    canvas.style.cursor = 'crosshair';
    selectButton(null);
}

function highlightLoadImageButton()
{
    // Legacy function - image loading now happens in page modal
    // This function is kept for compatibility but does nothing
    return;
}


function selectButton(buttonId)
{
    selectedButtonId = buttonId;
    const selectedButton = getSelectedButton();

    // Update button list UI
    document.querySelectorAll('.button-item').forEach(item =>
    {
        if (parseInt(item.dataset.buttonId) === buttonId)
        {
            item.classList.add('selected');
        } else
        {
            item.classList.remove('selected');
        }
    });

    // Enable/disable delete button
    document.getElementById('delete-button-btn').disabled = (buttonId === null);

    setButtonAppearancePanelVisible(Boolean(selectedButton) || document.getElementById('button-modal')?.style.display === 'flex');
    if (selectedButton)
    {
        populateButtonStyleControls(selectedButton);
    }
    else
    {
        updateButtonAppearancePanelHeading(null);
    }

    redraw();
}

async function deleteSelectedButton(event)
{
    if (event)
    {
        event.preventDefault();
        event.stopPropagation();
    }

    if (selectedButtonId === null) return;

    // Find the button to get its name for the confirmation message
    const buttons = getCurrentButtons();
    const buttonToDelete = buttons.find(b => b.id === selectedButtonId);
    const buttonName = buttonToDelete ? buttonToDelete.name : 'Button';

    const showConfirmation = window.showConfirmation;
    if (!showConfirmation)
    {
        console.error('showConfirmation not available');
        return;
    }

    const confirmDelete = await showConfirmation(
        `Delete button "${buttonName}"?`,
        'Delete Button',
        'Delete',
        'Cancel'
    );

    if (!confirmDelete)
    {
        // User cancelled the deletion - do nothing
        return;
    }

    // Proceed with deletion
    const updatedButtons = buttons.filter(b => b.id !== selectedButtonId);
    setCurrentButtons(updatedButtons);
    selectedButtonId = null;
    setButtonAppearancePanelVisible(false);
    updateButtonAppearancePanelHeading(null);
    const deleteButton = document.getElementById('delete-button-btn');
    if (deleteButton)
    {
        deleteButton.disabled = true;
    }

    markAsChanged();
    updateButtonList();
    redraw();
}

async function clearAllButtons()
{
    const buttons = getCurrentButtons();
    if (buttons.length === 0) return;

    // Get current page name for better messaging
    let pageName = 'current page';
    const currentPage = getCurrentPage();
    if (currentPage && currentPage.name)
    {
        pageName = `"${currentPage.name}"`;
    }
    else if (!currentPage)
    {
        // Legacy mode - use stick name
        pageName = `${currentStick} stick`;
    }

    const showConfirmation = window.showConfirmation;
    if (!showConfirmation)
    {
        console.error('showConfirmation not available');
        return;
    }

    const confirmed = await showConfirmation(
        `Are you sure you want to clear all ${buttons.length} button(s) from ${pageName}? This cannot be undone.`,
        'Clear All Buttons',
        'Clear All',
        'Cancel',
        'btn-danger'
    );

    if (!confirmed) return;

    setCurrentButtons([]);
    selectedButtonId = null;
    markAsChanged();
    updateButtonList();
    redraw();
}

async function mirrorTemplate()
{
    // Check if we have pages to mirror
    if (!templateData.pages || templateData.pages.length < 2)
    {
        await window.showAlert('You need at least 2 pages to use the mirror feature.', 'Not Enough Pages');
        return;
    }

    // Show mirror modal
    const modal = document.getElementById('mirror-template-modal');
    const sourceSelect = document.getElementById('mirror-source-page-select');
    const destSelect = document.getElementById('mirror-dest-page-select');
    const confirmBtn = document.getElementById('mirror-template-confirm-btn');
    const cancelBtn = document.getElementById('mirror-template-cancel-btn');

    // Populate dropdowns with pages
    sourceSelect.innerHTML = '<option value="">-- Select a page --</option>';
    destSelect.innerHTML = '<option value="">-- Select a page --</option>';

    templateData.pages.forEach(page =>
    {
        const option1 = document.createElement('option');
        option1.value = page.id;
        option1.textContent = page.name || `Page ${page.id}`;
        sourceSelect.appendChild(option1);

        const option2 = document.createElement('option');
        option2.value = page.id;
        option2.textContent = page.name || `Page ${page.id}`;
        destSelect.appendChild(option2);
    });

    // Auto-select the current page in the source dropdown
    if (currentPageId)
    {
        sourceSelect.value = currentPageId;
    }

    // Show modal
    modal.style.display = 'flex';

    // Wait for user action
    const result = await new Promise(resolve =>
    {
        const handleConfirm = () =>
        {
            const sourcePageId = sourceSelect.value;
            const destPageId = destSelect.value;

            if (!sourcePageId || !destPageId)
            {
                window.showAlert('Please select both a source and destination page.', 'Selection Required');
                return;
            }

            if (sourcePageId === destPageId)
            {
                window.showAlert('Source and destination pages must be different.', 'Invalid Selection');
                return;
            }

            cleanup();
            resolve({ sourcePageId, destPageId });
        };

        const handleCancel = () =>
        {
            cleanup();
            resolve(null);
        };

        const cleanup = () =>
        {
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            modal.style.display = 'none';
        };

        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
    });

    if (!result) return;

    // Find source and destination pages
    const sourcePage = templateData.pages.find(p => p.id === result.sourcePageId);
    const destPage = templateData.pages.find(p => p.id === result.destPageId);

    if (!sourcePage || !destPage)
    {
        await window.showAlert('Could not find selected pages.', 'Error');
        return;
    }

    // Get the image width for mirroring
    let imageWidth = null;

    // Try to get image width from source page
    if (sourcePage.image_data_url)
    {
        const img = new Image();
        img.src = sourcePage.image_data_url;
        await new Promise(resolve => { img.onload = resolve; });
        imageWidth = img.width;
    }
    else if (sourcePage.mirror_from_page_id)
    {
        // Source page mirrors another page, get that page's image
        const mirrorPage = templateData.pages.find(p => p.id === sourcePage.mirror_from_page_id);
        if (mirrorPage && mirrorPage.image_data_url)
        {
            const img = new Image();
            img.src = mirrorPage.image_data_url;
            await new Promise(resolve => { img.onload = resolve; });
            imageWidth = img.width;
        }
    }

    if (!imageWidth)
    {
        await window.showAlert('Source page does not have an image loaded.', 'No Image');
        return;
    }

    // Mirror all button positions from source to destination
    const sourceButtons = sourcePage.buttons || [];

    if (sourceButtons.length === 0)
    {
        await window.showAlert('Source page has no buttons to mirror.', 'No Buttons');
        return;
    }

    // Create mirrored copies of all buttons
    const mirroredButtons = sourceButtons.map(button =>
    {
        const mirroredButton = JSON.parse(JSON.stringify(button)); // Deep copy
        mirroredButton.id = Date.now() + Math.random(); // Give new unique ID

        // Mirror button position
        mirroredButton.buttonPos.x = imageWidth - mirroredButton.buttonPos.x;

        // Mirror label position
        if (mirroredButton.labelPos)
        {
            mirroredButton.labelPos.x = imageWidth - mirroredButton.labelPos.x;
        }

        return mirroredButton;
    });

    // Replace destination page buttons with mirrored copies
    destPage.buttons = mirroredButtons;

    markAsChanged();
    syncLegacyStickReferences();

    // Switch to destination page to show the mirrored result
    if (window.handleTemplatePageSelected)
    {
        window.handleTemplatePageSelected(destPage.id);
    }

    await window.showAlert(
        `Successfully mirrored ${sourceButtons.length} button(s) from "${sourcePage.name}" to "${destPage.name}"!`,
        'Mirror Complete'
    );
}




function updateButtonList()
{
    const listEl = document.getElementById('button-list');
    const buttons = getCurrentButtons();

    if (buttons.length === 0)
    {
        listEl.innerHTML = '<div class="empty-state-small">No buttons added yet</div>';
        document.getElementById('delete-button-btn').disabled = true;
        return;
    }

    let html = '';
    buttons.forEach(button =>
    {
        let inputInfo = '';

        if (button.buttonType === 'hat4way' && button.inputs)
        {
            const directions = [];
            if (button.inputs.up) directions.push('↑');
            if (button.inputs.down) directions.push('↓');
            if (button.inputs.left) directions.push('←');
            if (button.inputs.right) directions.push('→');
            if (button.inputs.push) directions.push('⬇');
            inputInfo = ` - Hat (${directions.join(' ')})`;
        }
        else
        {
            const displayInfo = getInputDisplayInfo(button);
            if (displayInfo.shortLabel)
            {
                inputInfo = ` - ${displayInfo.shortLabel}`;
            }
            else if (button.inputType && button.inputId !== undefined)
            {
                const label = button.inputType === 'axis' ? 'Axis' : (button.inputType === 'button' ? 'Button' : 'Input');
                inputInfo = ` - ${label} ${button.inputId}`;
            }
        }

        html += `
      <div class="button-item ${button.id === selectedButtonId ? 'selected' : ''}" 
           data-button-id="${button.id}"
           onclick="selectButtonFromList(${button.id})"
           ondblclick="editButtonFromList(${button.id})">
        <div class="button-item-name">${button.name || 'Unnamed Button'}${inputInfo}</div>
        <div class="button-item-coords">
          Button: (${Math.round(button.buttonPos.x)}, ${Math.round(button.buttonPos.y)})
          ${button.labelPos ? `<br>Label: (${Math.round(button.labelPos.x)}, ${Math.round(button.labelPos.y)})` : ''}
        </div>
      </div>
    `;
    });

    listEl.innerHTML = html;
}

window.selectButtonFromList = function (buttonId)
{
    selectButton(buttonId);
};

window.editButtonFromList = function (buttonId)
{
    const buttons = getCurrentButtons();
    const button = buttons.find(b => b.id === buttonId);
    if (!button) return;

    // Store original button data for cancel functionality
    originalButton = button;
    // Create a deep copy for editing
    tempButton = JSON.parse(JSON.stringify(button));

    // Open modal with current values
    document.getElementById('button-modal').style.display = 'flex';
    setButtonAppearancePanelVisible(true);
    document.getElementById('button-name-input').value = button.name || '';

    // Set button type
    const buttonType = button.buttonType || 'simple';
    document.getElementById('button-type-select').value = buttonType;
    onButtonTypeChange(); // Update UI sections
    populateButtonStyleControls(tempButton);

    // Clear stale modal socket state before repopulating current button data.
    updateSimpleInputPreview(null);
    resetHatDetectionButtons();

    // Load single-input button bindings
    if (buttonType === 'simple' || buttonType === 'axis')
    {
        updateSimpleInputPreview(tempButton);
    }
    // Multi-input (hat/toggle/rotary) - populate detected inputs
    else if (button.inputs)
    {
        updateHatDetectionButtons(button.inputs);
        updateMultiInputDisplays(button.inputs);
    }
    else
    {
        resetHatDetectionButtons();
    }

    document.getElementById('button-name-input').focus();

    // Allow Enter to save
    const input = document.getElementById('button-name-input');
    const enterHandler = (e) =>
    {
        if (e.key === 'Enter')
        {
            saveButtonDetails();
            input.removeEventListener('keypress', enterHandler);
        }
    };
    input.addEventListener('keypress', enterHandler);
};

// Button modal
function openButtonModal(button)
{
    document.getElementById('button-modal').style.display = 'flex';
    setButtonAppearancePanelVisible(true);
    document.getElementById('button-name-input').value = button.name || '';

    // Default to simple button type
    document.getElementById('button-type-select').value = 'simple';
    onButtonTypeChange();
    populateButtonStyleControls(button);

    // Clear button input preview for new buttons
    updateSimpleInputPreview(null);

    // Reset hat detection sockets
    resetHatDetectionButtons();

    // Clear any pending timeouts from previous detection session
    if (inputDetectionTimeout !== null)
    {
        clearTimeout(inputDetectionTimeout);
        inputDetectionTimeout = null;
    }

    if (hatDetectionTimeout !== null)
    {
        clearTimeout(hatDetectionTimeout);
        hatDetectionTimeout = null;
    }

    // Reset input detection status display
    document.getElementById('input-detection-status').style.display = 'none';
    document.getElementById('input-detection-status').textContent = '';
    document.getElementById('input-detection-status').style.color = '';

    // Reset hat detection status display
    document.getElementById('hat-detection-status').style.display = 'none';
    document.getElementById('hat-detection-status').textContent = '';
    document.getElementById('hat-detection-status').style.color = '';

    resetBindingOverlayState();

    // Reset detectingInput flag
    detectingInput = false;

    document.getElementById('button-name-input').focus();

    // Allow Enter to save
    const input = document.getElementById('button-name-input');
    const enterHandler = (e) =>
    {
        if (e.key === 'Enter')
        {
            saveButtonDetails();
            input.removeEventListener('keypress', enterHandler);
        }
    };
    input.addEventListener('keypress', enterHandler);
}

function closeButtonModal()
{
    // Stop any active input detection
    if (detectingInput)
    {
        stopInputDetection();
    }

    document.getElementById('button-modal').style.display = 'none';
    setButtonAppearancePanelVisible(false);

    // Only cancel if this was a new button being placed
    if (tempButton && mode === 'placing-label')
    {
        tempButton = null;
        placementPreviewPos = null;
        mode = 'view';
        redraw();
    }

    // Clear references (changes are discarded if user canceled)
    tempButton = null;
    originalButton = null;
}

async function saveButtonDetails()
{
    const name = document.getElementById('button-name-input').value.trim();

    if (!name)
    {
        const showAlert = window.showAlert || alert;
        await showAlert('Please enter a button name', 'Missing Name');
        return;
    }

    if (tempButton)
    {
        tempButton.name = name;

        const buttonType = document.getElementById('button-type-select').value;
        tempButton.buttonType = buttonType;

        try
        {
            const style = getButtonStyleFromModal(buttonType);
            if (style)
            {
                tempButton.style = style;
            }
            else
            {
                delete tempButton.style;
            }
        }
        catch (error)
        {
            const showAlert = window.showAlert || alert;
            await showAlert(error.message, 'Invalid Style');
            return;
        }

        // Save buttonId for simple buttons
        if (buttonType === 'simple')
        {
            // For simple buttons, keep existing buttonId if it was already set
            // It's display-only now, set only through auto-detection
            if (!tempButton.inputs)
            {
                tempButton.inputs = {};
            }
        }
        // Save hat direction IDs
        else if (buttonType === 'hat4way' || buttonType === 'hat2way-vertical' || buttonType === 'hat2way-horizontal')
        {
            if (!tempButton.inputs)
            {
                tempButton.inputs = {};
            }

            // Hat IDs are set only through auto-detection, so we just preserve what was already set
            // The inputs object is already populated by the detection process
        }

        // Check if this is a new button or editing an existing one
        const buttons = getCurrentButtons();
        const existingIndex = buttons.findIndex(b => b.id === tempButton.id);
        if (existingIndex === -1)
        {
            // New button - add to current stick
            buttons.push(tempButton);
            setCurrentButtons(buttons);
        }
        else
        {
            // Editing existing button - update the button in the array directly
            buttons[existingIndex] = tempButton;
            setCurrentButtons(buttons);
        }

        markAsChanged();
        selectButton(tempButton.id);
        tempButton = null;
        originalButton = null;
    }

    updateButtonList();
    redraw();
    closeButtonModal();
}

// Delete button from modal
async function deleteCurrentButton(event)
{
    if (event)
    {
        event.preventDefault();
        event.stopPropagation();
    }

    if (!tempButton)
    {
        console.warn('deleteCurrentButton called but tempButton is null');
        return;
    }

    // Check if button still exists BEFORE showing confirmation
    const buttonsBeforeConfirm = getCurrentButtons();
    const indexBeforeConfirm = buttonsBeforeConfirm.findIndex(b => b.id === tempButton.id);

    if (indexBeforeConfirm === -1)
    {
        const showAlert = window.showAlert || alert;
        await showAlert('Error: This button has already been deleted!', 'Delete Button');
        closeButtonModal();
        tempButton = null;
        updateButtonList();
        redraw();
        return;
    }

    // Import showConfirmation from main.js (available globally via window)
    const showConfirmation = window.showConfirmation;
    if (!showConfirmation)
    {
        console.error('showConfirmation not available');
        return;
    }

    const confirmDelete = await showConfirmation(
        `Delete button "${tempButton.name}"?`,
        'Delete Button',
        'Delete',
        'Cancel'
    );

    if (!confirmDelete)
    {
        // User cancelled the deletion - do nothing and keep modal open
        return;
    }


    // Proceed with deletion - verify button still exists (check again in case something changed)
    const buttons = getCurrentButtons();
    const index = buttons.findIndex(b => b.id === tempButton.id);

    if (index !== -1)
    {
        buttons.splice(index, 1);
        setCurrentButtons(buttons);
        markAsChanged();
        console.log('Button deleted successfully');
    }
    else
    {
        console.warn('Button was deleted between confirmation and deletion!');
    }

    // Clear references and close modal
    selectButton(null);
    tempButton = null;
    updateButtonList();
    redraw();
    closeButtonModal();
}

// Button type change handler
function onButtonTypeChange()
{
    const buttonType = document.getElementById('button-type-select').value;
    const isWidthType = isWidthAdjustableButtonType(buttonType);
    const isHeightType = isHeightAdjustableButtonType(buttonType);
    const styleControls = getStyleControls();
    if (styleControls.widthSection)
    {
        styleControls.widthSection.style.display = isWidthType ? 'grid' : 'none';
    }

    if (styleControls.heightSection)
    {
        styleControls.heightSection.style.display = isHeightType ? 'grid' : 'none';
    }

    const currentWidth = normalizeButtonStyle(tempButton?.style).width;
    if (isWidthType)
    {
        setModalWidthValue(currentWidth || getDefaultButtonWidth(buttonType));
    }

    const currentHeight = normalizeButtonStyle(tempButton?.style).height;
    if (isHeightType)
    {
        setModalHeightValue(currentHeight || getDefaultButtonHeight(buttonType));
    }

    // Show/hide appropriate input sections
    if (buttonType === 'simple' || buttonType === 'axis')
    {
        document.getElementById('simple-input-section').style.display = 'block';
        document.getElementById('hat-input-section').style.display = 'none';
    }
    else if (
        buttonType === 'hat4way' ||
        buttonType === 'hat2way-vertical' ||
        buttonType === 'hat2way-horizontal' ||
        buttonType === 'toggle3way-vertical' ||
        buttonType === 'toggle3way-horizontal' ||
        buttonType === 'rotary3way' ||
        buttonType === 'rotary4way'
    )
    {
        document.getElementById('simple-input-section').style.display = 'none';
        document.getElementById('hat-input-section').style.display = 'block';

        // Update visibility of direction elements based on hat type
        updateHatDirectionVisibility(buttonType);

        // Initialize inputs object if needed
        if (tempButton && !tempButton.inputs)
        {
            tempButton.inputs = {};
        }
    }

    // Update tempButton type
    if (tempButton)
    {
        tempButton.buttonType = buttonType;
    }

    refreshButtonGraphic();
}

function updateMultiInputDisplays(inputs)
{
    if (!inputs || typeof inputs !== 'object')
    {
        return;
    }
    document.querySelectorAll('.hat-input-socket').forEach(socket =>
    {
        const dir = socket.dataset.direction;
        if (!dir)
        {
            return;
        }

        const input = inputs[dir];
        if (!input)
        {
            const textSpan = socket.querySelector('.socket-text');
            if (textSpan) textSpan.textContent = '—';
            socket.classList.remove('has-value');
            return;
        }

        let displayText = '—';
        if (typeof input === 'string')
        {
            displayText = formatPrettyInputLabel(input);
        }
        else if (typeof input === 'object')
        {
            displayText = formatPrettyInputLabel(input);
        }

        const textSpan = socket.querySelector('.socket-text');
        if (textSpan) textSpan.textContent = displayText;
        socket.classList.add('has-value');
    });

    refreshButtonGraphic();
}

// Helper function to update visibility of hat direction UI elements
function updateHatDirectionVisibility(hatType)
{
    // Get all elements that have hat-type restrictions
    const hatElements = document.querySelectorAll('[data-hat-type]');

    hatElements.forEach(element =>
    {
        const allowedTypes = element.getAttribute('data-hat-type').split(',');
        if (allowedTypes.includes(hatType))
        {
            element.style.display = '';  // Show element
        }
        else
        {
            element.style.display = 'none';  // Hide element
        }
    });
}

// Helper function to detect input with dual-stage trigger support
// When a second button is detected before the first releases, use the second one
async function detectInputWithDualStageSupport(sessionId, timeoutSecs = 10, options = {})
{
    return new Promise((resolve) =>
    {
        const detectedInputs = [];
        const collectDurationSecs = 1; // Collect inputs for 1 second after first detection (must be integer)
        const sessionIdString = sessionId.toString();
        let unlistenInputDetected = null;
        let unlistenDetectionComplete = null;

        const cleanupListeners = () =>
        {
            if (typeof unlistenInputDetected === 'function')
            {
                unlistenInputDetected();
                unlistenInputDetected = null;
            }

            if (typeof unlistenDetectionComplete === 'function')
            {
                unlistenDetectionComplete();
                unlistenDetectionComplete = null;
            }
        };

        // Set up event listeners for input detection
        const handleInputDetected = (event) =>
        {
            const payload = event.payload;
            if (!payload || !payload.input_string)
            {
                return;
            }

            if (payload.session_id && payload.session_id !== sessionIdString)
            {
                return;
            }

            if (typeof options.filterInput === 'function' && !options.filterInput(payload))
            {
                return;
            }

            if (detectedInputs.some(input => input.input_string === payload.input_string))
            {
                return;
            }

            console.log('[DUAL-STAGE] Input detected:', payload.input_string);
            detectedInputs.push(payload);
            updateBindingOverlayCapturedInputs(detectedInputs);
        };

        const handleDetectionComplete = async (event) =>
        {
            if (event.payload.session_id !== sessionIdString)
            {
                return; // Ignore events from other sessions
            }

            console.log('[DUAL-STAGE] Detection complete, received', detectedInputs.length, 'input(s)');
            cleanupListeners();

            // Determine which input to use
            if (detectedInputs.length === 0)
            {
                console.log('[DUAL-STAGE] No inputs detected');
                resolve(null);
            }
            else if (detectedInputs.length === 1)
            {
                console.log('[DUAL-STAGE] Single input detected:', detectedInputs[0].input_string);
                resolve(detectedInputs[0]);
            }
            else
            {
                console.log('[DUAL-STAGE] Multiple inputs detected:', detectedInputs.map(i => i.input_string).join(', '));
                const selectedInput = await chooseBindingOverlayInput(detectedInputs);
                resolve(selectedInput);
            }
        };

        // Register event listeners
        if (window.__TAURI__)
        {
            window.__TAURI__.event.listen('input-detected', handleInputDetected).then(unlisten =>
            {
                unlistenInputDetected = unlisten;
            });
            window.__TAURI__.event.listen('input-detection-complete', handleDetectionComplete).then(unlisten =>
            {
                unlistenDetectionComplete = unlisten;
            });
        }

        // Start the detection process
        invoke('wait_for_inputs_with_events', {
            sessionId: sessionId.toString(),
            initialTimeoutSecs: timeoutSecs,
            collectDurationSecs: collectDurationSecs
        }).catch(error =>
        {
            console.error('[DUAL-STAGE] Detection error:', error);
            cleanupListeners();
            resolve(null);
        });
    });
}

// Hat switch input detection
async function startHatInputDetection(direction)
{
    if (detectingInput)
    {
        return;
    }

    detectingInput = true;
    const btn = document.querySelector(`.hat-input-socket[data-direction="${direction}"]`);
    if (!btn)
    {
        detectingInput = false;
        return;
    }
    btn.classList.add('detecting');
    btn.disabled = true;
    showBindingOverlay(`Press ${formatBindingOverlayLabel(direction)}`, 'Waiting for hat input...', 10);

    // Generate unique session ID for this detection
    const thisSessionId = Date.now() + Math.random();
    let delayOverlayDismiss = false;
    currentHatDetectionSessionId = thisSessionId;
    console.log('[HAT-DETECTION] Starting hat detection session:', thisSessionId, 'for direction:', direction);

    try
    {
        // Use enhanced detection with dual-stage trigger support
        const result = await detectInputWithDualStageSupport(thisSessionId, 10);

        // Check if this session is still active
        if (currentHatDetectionSessionId !== thisSessionId)
        {
            console.log('[HAT-DETECTION] Session', thisSessionId, 'cancelled, ignoring result');
            return;
        }

        if (result)
        {
            console.log('[HAT-DETECTION] Session', thisSessionId, 'detected input for', direction, ':', result);
            console.log('Input string:', result.input_string);

            // The Rust backend now returns proper Star Citizen format
            // Examples: "js1_hat1_up", "js1_button3", "js2_axis2"

            // Get the current page's configuration
            const currentPage = getCurrentPage();
            const currentStickData = currentPage || (currentStick === 'left' ? templateData.leftStick : templateData.rightStick);
            const templateJsNum = (currentStickData && currentStickData.joystickNumber) || templateData.joystickNumber || 1;

            let adjustedInputString = result.input_string;

            // Replace jsX_ with the current stick's template joystick number (js1 or js2)
            // OR use the page's explicit prefix if set (e.g. "js1", "gp1")
            if (currentPage && currentPage.device_prefix)
            {
                adjustedInputString = adjustedInputString.replace(/^(js|gp)\d+_/, `${currentPage.device_prefix}_`);
                console.log(`Adjusted input string for ${direction} using page prefix ${currentPage.device_prefix}:`, adjustedInputString);
            }
            else
            {
                adjustedInputString = adjustedInputString.replace(/^(js|gp)\d+_/, `js${templateJsNum}_`);
                console.log('Adjusted input string for', direction, '(remapped to template js number):', adjustedInputString);
            }

            // Convert to Star Citizen axis format using HID axis name from backend if it's an axis
            // Skip hat switches - they should be converted by backend already
            if (result.hid_axis_name && adjustedInputString.includes('_axis'))
            {
                const hidName = result.hid_axis_name.toLowerCase().replace(/\s+/g, '');

                // Skip hat switches - they need special handling by the backend
                if (hidName === 'hatswitch')
                {
                    console.log(`Hat ${direction}: Skipping HID axis conversion for hat switch - should already be in hat format`);
                }
                else
                {
                    // Convert HID axis name to SC format, including aliases like Slider -> slider1.
                    const scAxisName = normalizeHidAxisNameToSCAxisName(result.hid_axis_name);

                    // Replace axis number format with axis name format
                    adjustedInputString = adjustedInputString.replace(/axis\d+(?:_(positive|negative))?/, scAxisName);
                    console.log(`Hat ${direction}: Converted to SC format using HID axis name "${result.hid_axis_name}":`, adjustedInputString);
                }
            }

            // XInput reports numbered gp buttons/axes; SC expects semantic
            // gamepad names such as gp1_dpad_up and gp1_thumblx.
            if (typeof normalizeStarCitizenGamepadInput === 'function')
            {
                adjustedInputString = normalizeStarCitizenGamepadInput(adjustedInputString, {
                    preserveAxisDirection: true
                });
            }
            else if (typeof toStarCitizenFormat === 'function')
            {
                adjustedInputString = toStarCitizenFormat(adjustedInputString);
            }

            adjustedInputString = typeof ensureSliderNumber === 'function'
                ? ensureSliderNumber(adjustedInputString)
                : ensureTemplateSliderNumber(adjustedInputString);

            // Store the adjusted Star Citizen input string in tempButton
            if (tempButton)
            {
                if (!tempButton.inputs)
                {
                    tempButton.inputs = {};
                }

                // Store the complete SC format string (e.g., "js1_hat1_up" or "js1_button15")
                tempButton.inputs[direction] = adjustedInputString;
            }

            // Use shared utility for display name
            const displayText = parseInputShortName(result.input_string);

            const hatDisplayText = (typeof parseInputShortName === 'function')
                ? parseInputShortName(adjustedInputString)
                : (result.display_name || adjustedInputString);

            updateMultiInputDisplays(tempButton?.inputs || {});

            // Clear any existing timeout
            if (hatDetectionTimeout !== null)
            {
                clearTimeout(hatDetectionTimeout);
            }

            hatDetectionTimeout = setTimeout(() =>
            {
                document.getElementById('hat-detection-status').style.display = 'none';
                detectingInput = false; // Clear the flag after the timeout
                hatDetectionTimeout = null;
            }, 2000);
        }
        else
        {
            stopBindingOverlayCountdown({ hideTimer: false });
            setBindingOverlayTimer('Timed Out', { isError: true });
            delayOverlayDismiss = true;
        }
    }
    catch (error)
    {
        console.error('Error detecting input:', error);
        stopBindingOverlayCountdown({ hideTimer: false });
        setBindingOverlayTimer(`Error: ${error}`, { isError: true });
        delayOverlayDismiss = true;
    }
    finally
    {
        const isActiveSession = currentHatDetectionSessionId === thisSessionId;
        if (isActiveSession)
        {
            if (delayOverlayDismiss)
            {
                await delay(1500);
            }

            hideBindingOverlay();
            console.log('[HAT-DETECTION] Cleaning up session:', thisSessionId);
            currentHatDetectionSessionId = null;
            detectingInput = false;
            btn.disabled = false;
            btn.classList.remove('detecting');
        }
    }
}

// Joystick Input Detection
async function startInputDetection()
{
    if (detectingInput)
    {
        stopInputDetection();
        return;
    }

    detectingInput = true;
    const selectedButtonType = document.getElementById('button-type-select')?.value || tempButton?.buttonType || 'simple';
    const axisOnlyDetection = selectedButtonType === 'axis';
    const simpleSocket = document.getElementById('button-input-socket');
    simpleSocket?.classList.add('detecting');
    if (simpleSocket)
    {
        simpleSocket.disabled = true;
    }
    showBindingOverlay(
        axisOnlyDetection ? 'Move Axis' : 'Press Button',
        axisOnlyDetection ? 'Listening for axis input...' : 'Listening for joystick input...',
        10
    );

    // Generate unique session ID for this detection
    const thisSessionId = Date.now() + Math.random();
    let delayOverlayDismiss = false;
    currentDetectionSessionId = thisSessionId;
    console.log('[INPUT-DETECTION] Starting detection session:', thisSessionId);

    try
    {
        // Use enhanced detection with dual-stage trigger support
        const result = await detectInputWithDualStageSupport(thisSessionId, 10, {
            filterInput: axisOnlyDetection
                ? (payload) =>
                {
                    if (!payload || typeof payload.input_string !== 'string')
                    {
                        return false;
                    }

                    const hidName = payload.hid_axis_name ? payload.hid_axis_name.toLowerCase().replace(/\s+/g, '') : '';
                    return payload.input_string.includes('_axis') && hidName !== 'hatswitch';
                }
                : null
        });

        // Check if this session is still active
        if (currentDetectionSessionId !== thisSessionId)
        {
            console.log('[INPUT-DETECTION] Session', thisSessionId, 'cancelled, ignoring result');
            return;
        }

        if (result)
        {
            console.log('[INPUT-DETECTION] Session', thisSessionId, 'detected input:', result);
            console.log('Input string:', result.input_string);

            // The Rust backend now returns proper Star Citizen format
            // Examples: "js1_hat1_up", "js1_button3", "js2_axis2"

            // Get the current page's configuration
            const currentPage = getCurrentPage();
            const currentStickData = currentPage || (currentStick === 'left' ? templateData.leftStick : templateData.rightStick);
            const templateJsNum = (currentStickData && currentStickData.joystickNumber) || templateData.joystickNumber || 1;

            let adjustedInputString = result.input_string;

            // Replace jsX_ with the current stick's template joystick number (js1 or js2)
            // OR use the page's explicit prefix if set (e.g. "js1", "gp1")
            if (currentPage && currentPage.device_prefix)
            {
                adjustedInputString = adjustedInputString.replace(/^(js|gp)\d+_/, `${currentPage.device_prefix}_`);
                console.log(`Adjusted input string using page prefix ${currentPage.device_prefix}:`, adjustedInputString);
            }
            else
            {
                adjustedInputString = adjustedInputString.replace(/^(js|gp)\d+_/, `js${templateJsNum}_`);
                console.log('Adjusted input string (remapped to template js number):', adjustedInputString);
            }

            // Convert to Star Citizen axis format using HID axis name from backend (e.g., js1_axis2 -> js1_rz)
            // This ensures we use the actual axis name from the HID descriptor, not hardcoded mappings
            // Skip hat switches - they should be converted by backend already
            if (result.hid_axis_name && adjustedInputString.includes('_axis'))
            {
                const hidName = result.hid_axis_name.toLowerCase().replace(/\s+/g, '');

                // Skip hat switches - they need special handling by the backend
                if (hidName === 'hatswitch')
                {
                    console.log('Skipping HID axis conversion for hat switch - should already be in hat format');
                }
                else
                {
                    // Convert HID axis name to SC format, including aliases like Slider -> slider1.
                    const scAxisName = normalizeHidAxisNameToSCAxisName(result.hid_axis_name);

                    // Replace axis number format with axis name format
                    adjustedInputString = adjustedInputString.replace(/axis\d+(?:_(positive|negative))?/, scAxisName);
                    console.log(`Converted to Star Citizen format using HID axis name "${result.hid_axis_name}":`, adjustedInputString);
                }
            }
            else if (adjustedInputString.includes('_axis'))
            {
                // Fallback: use hardcoded mapping if no HID axis name available (for XInput gamepads)
                const scFormatString = toStarCitizenFormat(adjustedInputString);
                if (scFormatString)
                {
                    adjustedInputString = scFormatString;
                    console.log('Converted to Star Citizen format using default mapping:', adjustedInputString);
                }
            }

            // Also normalize numbered XInput buttons (for example,
            // gp1_button11 -> gp1_dpad_up).
            if (typeof toStarCitizenFormat === 'function')
            {
                adjustedInputString = toStarCitizenFormat(adjustedInputString);
            }

            adjustedInputString = typeof ensureSliderNumber === 'function'
                ? ensureSliderNumber(adjustedInputString)
                : ensureTemplateSliderNumber(adjustedInputString);

            // Use shared utility for friendly name (use adjusted string)
            // Prefer short name to avoid device prefix (e.g., "Joystick 1 - Button 13")
            const inputName = (typeof parseInputShortName === 'function')
                ? parseInputShortName(adjustedInputString)
                : parseInputDisplayName(adjustedInputString);

            // Update the input field with a friendly name only if empty
            const buttonNameInput = document.getElementById('button-name-input');
            if (!buttonNameInput.value)
            {
                buttonNameInput.value = inputName;
            }

            // Store the adjusted Star Citizen format string in tempButton
            if (tempButton)
            {
                tempButton.buttonType = axisOnlyDetection ? 'axis' : 'simple';
                // Only set name if it's currently empty
                if (!tempButton.name)
                {
                    tempButton.name = inputName;
                }

                if (!tempButton.inputs)
                {
                    tempButton.inputs = {};
                }

                tempButton.inputs.main = adjustedInputString;

                const buttonMatch = adjustedInputString.match(/button(\d+)/);
                const axisNumericMatch = adjustedInputString.match(/axis(\d+)(?:_(positive|negative))?/);
                const axisSCMatch = adjustedInputString.match(/^(js|gp)\d+_(x|y|z|rotx|roty|rotz|slider1|slider2)(?:_(positive|negative))?$/);
                const hatMatch = adjustedInputString.match(/hat(\d+)_(up|down|left|right)/);

                if (hatMatch)
                {
                    // Hat switch input (e.g., js2_hat1_up)
                    const hatNum = parseInt(hatMatch[1]);
                    const hatDirection = hatMatch[2];
                    delete tempButton.buttonId;
                    tempButton.inputType = 'hat';
                    tempButton.inputId = hatNum;
                    tempButton.hatDirection = hatDirection;
                    delete tempButton.axisDirection;
                }
                else if (buttonMatch)
                {
                    const buttonId = parseInt(buttonMatch[1]);
                    tempButton.buttonId = buttonId;
                    tempButton.inputType = 'button';
                    tempButton.inputId = buttonId;
                    delete tempButton.axisDirection;
                }
                else if (axisNumericMatch)
                {
                    const axisId = parseInt(axisNumericMatch[1]);
                    delete tempButton.buttonId;
                    tempButton.inputType = 'axis';
                    tempButton.inputId = axisId;
                    tempButton.axisDirection = axisNumericMatch[2] || null;
                }
                else if (axisSCMatch)
                {
                    // Star Citizen axis format (e.g., js1_x, js1_y)
                    delete tempButton.buttonId;
                    tempButton.inputType = 'axis';
                    tempButton.inputId = typeof ensureSliderNumber === 'function'
                        ? ensureSliderNumber(axisSCMatch[2])
                        : ensureTemplateSliderNumber(axisSCMatch[2]);
                    tempButton.axisDirection = axisSCMatch[3] || null;
                }
                else
                {
                    delete tempButton.buttonId;
                    delete tempButton.axisDirection;
                    tempButton.inputType = 'input';
                    tempButton.inputId = undefined;
                }

                updateSimpleInputPreview(tempButton);
            }

            // Show confirmation
            // Clear any existing timeout
            if (inputDetectionTimeout !== null)
            {
                clearTimeout(inputDetectionTimeout);
            }

            inputDetectionTimeout = setTimeout(() =>
            {
                document.getElementById('input-detection-status').style.display = 'none';
                document.getElementById('input-detection-status').style.color = '';
                detectingInput = false; // Clear the flag after the timeout
                inputDetectionTimeout = null;
            }, 2000);
        }
        else
        {
            stopBindingOverlayCountdown({ hideTimer: false });
            setBindingOverlayTimer('Timed Out', { isError: true });
            delayOverlayDismiss = true;

            // Clear any existing timeout
            if (inputDetectionTimeout !== null)
            {
                clearTimeout(inputDetectionTimeout);
            }

            inputDetectionTimeout = setTimeout(() =>
            {
                document.getElementById('input-detection-status').style.display = 'none';
                document.getElementById('input-detection-status').style.color = '';
                inputDetectionTimeout = null;
            }, 3000);
        }
    }
    catch (error)
    {
        console.error('Error detecting input:', error);
        stopBindingOverlayCountdown({ hideTimer: false });
        setBindingOverlayTimer(`Error: ${error}`, { isError: true });
        delayOverlayDismiss = true;
    }
    finally
    {
        const isActiveSession = currentDetectionSessionId === thisSessionId;
        if (isActiveSession)
        {
            if (delayOverlayDismiss)
            {
                await delay(1500);
            }

            hideBindingOverlay();
            console.log('[INPUT-DETECTION] Cleaning up session:', thisSessionId);
            currentDetectionSessionId = null;
            detectingInput = false;
            const simpleSocket = document.getElementById('button-input-socket');
            simpleSocket?.classList.remove('detecting');
            if (simpleSocket)
            {
                simpleSocket.disabled = false;
            }
        }
    }
}

function stopInputDetection()
{
    // Clear any pending timeouts
    if (inputDetectionTimeout !== null)
    {
        clearTimeout(inputDetectionTimeout);
        inputDetectionTimeout = null;
    }

    if (hatDetectionTimeout !== null)
    {
        clearTimeout(hatDetectionTimeout);
        hatDetectionTimeout = null;
    }

    // Clear session IDs to invalidate any pending operations
    console.log('[INPUT-DETECTION] Stopping detection, clearing sessions');
    currentDetectionSessionId = null;
    currentHatDetectionSessionId = null;

    detectingInput = false;
    const simpleSocket = document.getElementById('button-input-socket');
    simpleSocket?.classList.remove('detecting');
    if (simpleSocket)
    {
        simpleSocket.disabled = false;
    }
    document.getElementById('input-detection-status').style.display = 'none';
    resetBindingOverlayState();
}

// Clear simple button input
function clearSimpleButtonInput()
{
    if (!tempButton) return;

    tempButton.inputs = {};
    tempButton.buttonId = undefined;
    delete tempButton.inputType;
    delete tempButton.inputId;
    delete tempButton.axisDirection;
    updateSimpleInputPreview(tempButton);
    document.getElementById('input-detection-status').style.display = 'none';

    markAsChanged();
}

// Clear hat direction input
function clearHatDirection(direction)
{
    if (!tempButton) return;

    if (tempButton.inputs)
    {
        delete tempButton.inputs[direction];
    }

    updateMultiInputDisplays(tempButton.inputs || {});
    document.getElementById('hat-detection-status').style.display = 'none';
    resetBindingOverlayState();

    markAsChanged();
}

// Template save/load
// Helper function to prepare save data
function prepareSaveData()
{
    const serializeButton = (b) =>
    {
        const style = normalizeButtonStyle(b.style);
        const savedButton = {
            id: b.id,
            name: b.name,
            buttonPos: b.buttonPos,
            labelPos: b.labelPos,
            buttonType: b.buttonType || 'simple',
            inputs: b.inputs || {},
            inputType: b.inputType,
            inputId: b.inputId
        };

        if (Object.keys(style).length > 0)
        {
            savedButton.style = style;
        }

        return savedButton;
    };

    // Prepare data for saving - only pages array is used now
    return {
        name: templateData.name,
        version: templateData.version || '1.0',
        imageWidth: loadedImage ? loadedImage.width : 0,
        imageHeight: loadedImage ? loadedImage.height : 0,
        pages: Array.isArray(templateData.pages) ? templateData.pages.map(page => ({
            id: page.id,
            name: page.name || 'Untitled Page',
            device_uuid: page.device_uuid || '',
            device_name: page.device_name || '',
            joystickNumber: page.joystickNumber || 1,
            device_prefix: page.device_prefix || '',
            axis_profile: page.axis_profile || 'default',
            axis_mapping: page.axis_mapping || {},
            image_path: page.image_path || '',
            image_data_url: page.image_data_url || null,
            mirror_from_page_id: page.mirror_from_page_id || '',
            buttons: (page.buttons || []).map(serializeButton)
        })) : []
    };
}

// Show save notification with optional viewer update status
function showSaveNotification(viewerUpdated = false)
{
    let message = 'Template saved successfully';
    if (viewerUpdated)
    {
        message += ' • Joystick Viewer updated';
    }

    // Use global toast system if available
    if (window.toast)
    {
        window.toast.success(message);
        return;
    }

    // Fallback: Create notification element
    const notification = document.createElement('div');
    notification.className = 'template-save-notification';

    notification.innerHTML = `
        <span class="notification-icon">💾</span>
        <span class="notification-message">✓ ${message}</span>
    `;

    document.body.appendChild(notification);

    // Fade out and remove after 3 seconds
    setTimeout(() =>
    {
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Helper function to save template to a given file path
async function performSave(filePath, showNotification = true, showErrorAlert = true)
{
    const showAlert = window.showAlert || alert;

    try
    {
        const saveData = prepareSaveData();

        await invoke('save_template', {
            filePath,
            templateJson: JSON.stringify(saveData, null, 2)
        });
        hideBindingOverlay();

        // Update current file path for future saves
        currentTemplateFilePath = filePath;

        // Persist to editor-specific localStorage
        localStorage.setItem('editorCurrentTemplate', JSON.stringify(saveData));
        const fileName = filePath.split(/[\\\/]/).pop();
        localStorage.setItem('editorTemplateFileName', fileName);
        localStorage.setItem('editorTemplateFilePath', filePath);

        // Notify viewer tab if it has the same template open (same window)
        // Clear any previous viewer update flag
        localStorage.removeItem('viewerWasUpdated');

        try
        {
            window.dispatchEvent(new StorageEvent('storage', {
                key: 'editorCurrentTemplate',
                newValue: JSON.stringify(saveData),
                url: window.location.href,
                storageArea: localStorage
            }));
        }
        catch (error)
        {
            console.error('[EDITOR] Error dispatching storage event:', error);
        }

        // Wait a moment to see if viewer responded
        await new Promise(resolve => setTimeout(resolve, 100));
        const viewerUpdated = localStorage.getItem('viewerWasUpdated') === 'true';
        localStorage.removeItem('viewerWasUpdated');

        // Clear unsaved changes
        hasUnsavedChanges = false;
        updateTemplateUnsavedIndicator();

        // Update file indicator with path
        updateTemplateFileIndicator(filePath);

        // Update header template name
        if (window.updateTemplateIndicator)
        {
            window.updateTemplateIndicator(templateData.name, fileName);
        }

        if (showNotification)
        {
            showSaveNotification(viewerUpdated);
        }

        return { success: true };
    } catch (error)
    {
        console.error('Error saving template:', error);
        if (showErrorAlert)
        {
            await showAlert(`Failed to save template: ${error}`, 'Error');
        }
        return { success: false, error };
    }
}

async function promptForTemplateSavePath(defaultPath = undefined)
{
    return await save({
        filters: [{
            name: 'Joystick Template',
            extensions: ['json']
        }],
        defaultPath
    });
}

async function saveTemplateWithDialog(defaultPath = undefined)
{
    const filePath = await promptForTemplateSavePath(defaultPath);
    if (!filePath)
    {
        return { success: false, cancelled: true };
    }

    return await performSave(filePath, true);
}

// Save to current file (auto-save), or show dialog if no current file
async function saveTemplate()
{
    const showAlert = window.showAlert || alert;

    if (!templateData.name)
    {
        await showAlert('Please enter a template name', 'Missing Template Name');
        document.getElementById('template-name').focus();
        return;
    }

    // For dual image mode, require both images
    if (templateData.imageType === 'dual')
    {
        if (!templateData.leftImageDataUrl || !templateData.rightImageDataUrl)
        {
            await showAlert('Please load images for both left and right sticks', 'Images Required');
            return;
        }
    }

    // Count buttons from nested structure
    const leftButtons = getCurrentButtons();
    const rightButtons = currentStick === 'left' ?
        (templateData.rightStick?.buttons || templateData.rightStick || []) :
        (templateData.leftStick?.buttons || templateData.leftStick || []);
    const totalButtons = leftButtons.length + (Array.isArray(rightButtons) ? rightButtons.length : 0);

    if (totalButtons === 0)
    {
        await showAlert('Please add at least one button.', 'No Buttons Defined');
        return;
    }

    // If we have a current file path, save directly without dialog
    if (currentTemplateFilePath)
    {
        const result = await performSave(currentTemplateFilePath, true, false);
        if (result.success)
        {
            return;
        }

        if (isMissingPathSaveError(result.error))
        {
            clearCurrentTemplateFilePath();
            await showAlert('The previous template save location is no longer available. Choose a new location to save this template.', 'Save Location Missing');
            await saveTemplateWithDialog();
            return;
        }

        await showAlert(`Failed to save template: ${result.error}`, 'Error');
        return;
    }

    // Otherwise, show file picker (same as Save As)
    try
    {
        let resourceDir;
        try
        {
            resourceDir = await invoke('get_resource_dir');
        }
        catch (e)
        {
            console.warn('Could not get resource directory:', e);
            resourceDir = undefined;
        }

        await saveTemplateWithDialog(resourceDir);
    } catch (error)
    {
        console.error('Error saving template:', error);
        await showAlert(`Failed to save template: ${error}`, 'Error');
    }
}

// Save As - always shows file picker
async function saveTemplateAs()
{
    const showAlert = window.showAlert || alert;

    if (!templateData.name)
    {
        await showAlert('Please enter a template name', 'Missing Template Name');
        document.getElementById('template-name').focus();
        return;
    }

    if (!loadedImage)
    {
        await showAlert('Please load a joystick image', 'No Image Loaded');
        return;
    }

    // For dual image mode, require both images
    if (templateData.imageType === 'dual')
    {
        if (!templateData.leftImageDataUrl || !templateData.rightImageDataUrl)
        {
            await showAlert('Please load images for both left and right sticks', 'Images Required');
            return;
        }
    }

    // Count buttons from nested structure
    const leftButtons = getCurrentButtons();
    const rightButtons = currentStick === 'left' ?
        (templateData.rightStick?.buttons || templateData.rightStick || []) :
        (templateData.leftStick?.buttons || templateData.leftStick || []);
    const totalButtons = leftButtons.length + (Array.isArray(rightButtons) ? rightButtons.length : 0);

    if (totalButtons === 0)
    {
        await showAlert('Please add at least one button.', 'No Buttons Defined');
        return;
    }

    try
    {
        let resourceDir;
        try
        {
            resourceDir = await invoke('get_resource_dir');
        }
        catch (e)
        {
            console.warn('Could not get resource directory:', e);
            resourceDir = undefined;
        }

        await saveTemplateWithDialog(resourceDir);
    } catch (error)
    {
        console.error('Error saving template:', error);
        await showAlert(`Failed to save template: ${error}`, 'Error');
    }
}

async function loadTemplate()
{
    try
    {
        let defaultPath;
        try
        {
            defaultPath = await invoke('get_resource_dir');
        }
        catch (e)
        {
            console.warn('Could not get resource directory:', e);
        }

        const filePath = await open({
            filters: [{
                name: 'Joystick Template',
                extensions: ['json']
            }],
            multiple: false,
            defaultPath: defaultPath
        });

        if (!filePath) return; // User cancelled

        const templateJson = await invoke('load_template', { filePath });
        const data = normalizeTemplateSliderIds(JSON.parse(templateJson));

        // Migrate template if needed (v1.0 -> v1.1)
        if (data.version === '1.0' || !data.version)
        {
            migrateTemplateToV11(data);
        }

        // Load the data - handle both old and new formats
        templateData.name = data.name || '';
        templateData.joystickNumber = data.joystickNumber || 1;

        // Handle buttons: support multiple formats
        // Format 1: New nested format { leftStick: { joystickNumber: 1, buttons: [...] }, rightStick: { joystickNumber: 2, buttons: [...] } }
        // Format 2: Flat array format { leftStick: [...], rightStick: [...] }
        // Format 3: Old single stick format { buttons: [...] }

        if (data.leftStick || data.rightStick)
        {
            // New dual stick format (nested or flat)
            templateData.leftStick = data.leftStick || { joystickNumber: 1, buttons: [] };
            templateData.rightStick = data.rightStick || { joystickNumber: 2, buttons: [] };

            // Ensure nested structure has buttons array
            if (templateData.leftStick && typeof templateData.leftStick === 'object' && !Array.isArray(templateData.leftStick) && !templateData.leftStick.buttons)
            {
                templateData.leftStick.buttons = [];
            }
            if (templateData.rightStick && typeof templateData.rightStick === 'object' && !Array.isArray(templateData.rightStick) && !templateData.rightStick.buttons)
            {
                templateData.rightStick.buttons = [];
            }
        }
        else if (data.buttons)
        {
            // Old single stick format - put all buttons in right stick by default
            templateData.leftStick = { joystickNumber: 1, buttons: [] };
            templateData.rightStick = { joystickNumber: 2, buttons: data.buttons || [] };
        }
        else
        {
            // No buttons at all
            templateData.leftStick = { joystickNumber: 1, buttons: [] };
            templateData.rightStick = { joystickNumber: 2, buttons: [] };
        }
        templateData.version = data.version || '1.0';
        templateData.pages = Array.isArray(data.pages) ? data.pages : [];
        ensureTemplatePages();
        refreshTemplatePagesUI(templateData);

        // Persist to editor-specific localStorage
        localStorage.setItem('editorCurrentTemplate', JSON.stringify(data));
        const fileName = filePath.split(/[\\\/]/).pop();
        localStorage.setItem('editorTemplateFileName', fileName);
        localStorage.setItem('editorTemplateFilePath', filePath);

        // Set current file path for auto-save
        currentTemplateFilePath = filePath;

        // Reset unsaved changes
        hasUnsavedChanges = false;
        updateTemplateUnsavedIndicator();

        // Update file indicator with path
        updateTemplateFileIndicator(filePath);

        // Update header template name
        console.log('loadTemplate - data.name:', data.name);
        console.log('window.updateTemplateIndicator exists:', typeof window.updateTemplateIndicator);
        if (window.updateTemplateIndicator)
        {
            console.log('Calling updateTemplateIndicator with:', data.name || 'Untitled Template', fileName);
            window.updateTemplateIndicator(data.name || 'Untitled Template', fileName);
        }
        else
        {
            console.log('window.updateTemplateIndicator is not available');
        }

        // Update UI
        document.getElementById('template-name').value = templateData.name;

        // Load the first page's image if we have pages
        if (currentPageId && templateData.pages.length > 0)
        {
            const firstPage = templateData.pages.find(p => p.id === currentPageId);
            if (firstPage)
            {
                loadPageImage(firstPage);
                updateButtonList();
            }
        }
        // Legacy image handling for backward compatibility (only if no pages)
        else if (templateData.imageType === 'dual' && templateData.leftImageDataUrl)
        {
            const img = new Image();
            img.onload = () =>
            {
                resizeImage(img, 1024, (resizedImg) =>
                {
                    loadedImage = resizedImg;
                    resizeCanvas();
                    requestAnimationFrame(() =>
                    {
                        fitToScreen();
                        updateButtonList();
                    });
                });
            };
            img.src = templateData.leftImageDataUrl;
        }
        else if (templateData.imageDataUrl)
        {
            hideBindingOverlay();
            const img = new Image();
            img.onload = () =>
            {
                resizeImage(img, 1024, (resizedImg) =>
                {
                    loadedImage = resizedImg;
                    resizeCanvas();
                    requestAnimationFrame(() =>
                    {
                        fitToScreen();
                        updateButtonList();
                    });
                });
            };
            img.src = templateData.imageDataUrl;
        }

    } catch (error)
    {
        console.error('Error loading template:', error);
        const showAlert = window.showAlert || alert;
        await showAlert(`Failed to load template: ${error}`, 'Error');
    }
}

// Helper functions for hat detection buttons
function resetHatDetectionButtons()
{
    document.querySelectorAll('.hat-input-socket').forEach(btn =>
    {
        btn.classList.remove('has-value', 'detecting');
        btn.disabled = false;
        const textSpan = btn.querySelector('.socket-text');
        if (textSpan) textSpan.textContent = '—';
    });
    document.getElementById('hat-detection-status').style.display = 'none';
    resetBindingOverlayState();
    hideBindingOverlay();
}

function updateHatDetectionButtons(inputs)
{
    Object.keys(inputs).forEach(direction =>
    {
        const input = inputs[direction];
        const socket = document.querySelector(`.hat-input-socket[data-direction="${direction}"]`);
        if (socket && input)
        {
            socket.classList.add('has-value');
        }
    });
}

function updateFileIndicator()
{
    const indicator = document.getElementById('loaded-file-indicator');
    const fileNameEl = document.getElementById('loaded-file-name');
    const savedPath = localStorage.getItem('keybindingsFilePath');

    if (indicator && fileNameEl && savedPath)
    {
        const fileName = savedPath.split(/[\\\\/]/).pop();
        fileNameEl.textContent = fileName;
        indicator.style.display = 'flex';
    }
}

function updateUnsavedIndicator()
{
    const indicator = document.getElementById('loaded-file-indicator');
    const fileNameEl = document.getElementById('loaded-file-name');

    if (indicator && fileNameEl)
    {
        if (typeof hasUnsavedChanges !== 'undefined' && hasUnsavedChanges)
        {
            indicator.style.borderColor = 'var(--accent-primary)';
            indicator.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
            if (!fileNameEl.textContent.includes('*'))
            {
                fileNameEl.textContent += ' *';
            }
        }
        else
        {
            indicator.style.borderColor = 'var(--button-border)';
            indicator.style.backgroundColor = 'var(--bg-medium)';
            fileNameEl.textContent = fileNameEl.textContent.replace(' *', '');
        }
    }
}

function loadPersistedTemplate()
{
    try
    {
        // Use editor-specific storage key to avoid interference from visual viewer
        const savedTemplate = localStorage.getItem('editorCurrentTemplate');
        if (savedTemplate)
        {
            const data = normalizeTemplateSliderIds(JSON.parse(savedTemplate));

            // Migrate template if needed (v1.0 -> v1.1)
            if (data.version === '1.0' || !data.version)
            {
                migrateTemplateToV11(data);
                // Save migrated template back to editor-specific localStorage
                localStorage.setItem('editorCurrentTemplate', JSON.stringify(data));
            }

            // Restore file path for auto-save functionality (use editor-specific key)
            const savedFilePath = localStorage.getItem('editorTemplateFilePath');
            if (savedFilePath)
            {
                currentTemplateFilePath = savedFilePath;
            }

            // Restore camera positions if available (use editor-specific keys)
            const savedLeftCamera = localStorage.getItem('editorLeftStickCamera');
            const savedRightCamera = localStorage.getItem('editorRightStickCamera');

            if (savedLeftCamera)
            {
                leftStickCamera = sanitizeCameraState(JSON.parse(savedLeftCamera));
            }
            if (savedRightCamera)
            {
                rightStickCamera = sanitizeCameraState(JSON.parse(savedRightCamera));
            }

            // Load the data
            templateData.name = data.name || '';
            templateData.joystickModel = data.joystickModel || '';
            templateData.joystickNumber = data.joystickNumber || 1;
            templateData.imagePath = data.imagePath || '';
            templateData.imageDataUrl = data.imageDataUrl || null;

            // Handle imageType
            templateData.imageType = data.imageType || 'single';

            // Handle dual image data
            templateData.leftImagePath = data.leftImagePath || '';
            templateData.leftImageDataUrl = data.leftImageDataUrl || null;
            templateData.rightImagePath = data.rightImagePath || '';
            templateData.rightImageDataUrl = data.rightImageDataUrl || null;

            // Handle imageFlipped: convert old boolean format to new format
            if (typeof data.imageFlipped === 'boolean')
            {
                templateData.imageFlipped = data.imageFlipped ? 'left' : 'right';
            }
            else
            {
                templateData.imageFlipped = data.imageFlipped || 'right';
            }

            // Handle buttons: support multiple formats
            // Format 1: New nested format { leftStick: { joystickNumber: 1, buttons: [...] }, rightStick: { joystickNumber: 2, buttons: [...] } }
            // Format 2: Flat array format { leftStick: [...], rightStick: [...] }
            // Format 3: Old single stick format { buttons: [...] }

            if (data.leftStick || data.rightStick)
            {
                // New dual stick format (nested or flat)
                templateData.leftStick = data.leftStick || { joystickNumber: 1, buttons: [] };
                templateData.rightStick = data.rightStick || { joystickNumber: 2, buttons: [] };

                // Ensure nested structure has buttons array
                if (templateData.leftStick && typeof templateData.leftStick === 'object' && !Array.isArray(templateData.leftStick) && !templateData.leftStick.buttons)
                {
                    templateData.leftStick.buttons = [];
                }
                if (templateData.rightStick && typeof templateData.rightStick === 'object' && !Array.isArray(templateData.rightStick) && !templateData.rightStick.buttons)
                {
                    templateData.rightStick.buttons = [];
                }
            }
            else if (data.buttons)
            {
                // Old single stick format - put all buttons in right stick by default
                templateData.leftStick = { joystickNumber: 1, buttons: [] };
                templateData.rightStick = { joystickNumber: 2, buttons: data.buttons || [] };
            }
            else
            {
                // No buttons at all
                templateData.leftStick = { joystickNumber: 1, buttons: [] };
                templateData.rightStick = { joystickNumber: 2, buttons: [] };
            }

            templateData.version = data.version || '1.0';
            templateData.pages = Array.isArray(data.pages) ? data.pages : [];
            ensureTemplatePages();
            refreshTemplatePagesUI(templateData);

            // Update UI
            document.getElementById('template-name').value = templateData.name;

            // Update file indicator based on whether we have a saved file path
            if (currentTemplateFilePath)
            {
                updateTemplateFileIndicator(currentTemplateFilePath);
            }
            else
            {
                showUnsavedTemplateIndicator();
            }

            // Load the first page's image if we have pages
            if (currentPageId && templateData.pages.length > 0)
            {
                const firstPage = templateData.pages.find(p => p.id === currentPageId);
                if (firstPage)
                {
                    loadPageImage(firstPage);
                    updateButtonList();
                }
            }
            // Legacy image handling for backward compatibility (only if no pages)
            else if (templateData.imageType === 'dual' && templateData.leftImageDataUrl)
            {
                const img = new Image();
                img.onload = () =>
                {
                    resizeImage(img, 1024, (resizedImg) =>
                    {
                        loadedImage = resizedImg;
                        resizeCanvas();
                        requestAnimationFrame(() =>
                        {
                            fitToScreen();
                            updateButtonList();
                        });
                    });
                };
                img.src = templateData.leftImageDataUrl;
            }
            else if (templateData.imageDataUrl)
            {
                const img = new Image();
                img.onload = () =>
                {
                    resizeImage(img, 1024, (resizedImg) =>
                    {
                        loadedImage = resizedImg;
                        resizeCanvas();
                        requestAnimationFrame(() =>
                        {
                            fitToScreen();
                            updateButtonList();
                        });
                    });
                };
                img.src = templateData.imageDataUrl;
            }
        }
        else
        {
            // No persisted template found, show unsaved indicator for the fresh state
            showUnsavedTemplateIndicator();

            // Ensure we have a clean state
            templateData.pages = [];
            ensureTemplatePages();
            refreshTemplatePagesUI(templateData);

            // Reset UI
            document.getElementById('template-name').value = '';
        }
    } catch (error)
    {
        console.error('Error loading persisted template:', error);
    }
}

function markAsChanged()
{
    hasUnsavedChanges = true;
    updateTemplateUnsavedIndicator();

    // Also persist to editor-specific localStorage for recovery
    try
    {
        localStorage.setItem('editorCurrentTemplate', JSON.stringify(templateData));
        // Also persist camera positions for each stick using editor-specific keys
        localStorage.setItem('editorLeftStickCamera', JSON.stringify(leftStickCamera));
        localStorage.setItem('editorRightStickCamera', JSON.stringify(rightStickCamera));
    } catch (error)
    {
        console.error('Error persisting template changes:', error);
    }
}

window.markTemplateAsChanged = markAsChanged;

// ============================================================================
// TEMPLATE FILE INDICATOR MANAGEMENT
// ============================================================================

/**
 * Update the template file indicator with the given file path
 * @param {string} filePath - Full path to the template file
 */
function updateTemplateFileIndicator(filePath)
{
    const indicator = document.getElementById('template-file-indicator');
    const filePathEl = document.getElementById('template-file-path');
    const fileNameEl = document.getElementById('template-file-name');

    if (!indicator || !filePathEl || !fileNameEl) return;

    // Extract path and filename separately
    const lastSlashIndex = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
    const fileName = lastSlashIndex !== -1 ? filePath.substring(lastSlashIndex + 1) : filePath;
    const dirPath = lastSlashIndex !== -1 ? filePath.substring(0, lastSlashIndex + 1) : '';

    // Update elements
    filePathEl.textContent = dirPath;
    fileNameEl.textContent = fileName;
    fileNameEl.title = filePath; // Add tooltip for full path
    indicator.style.display = 'flex';
}

/**
 * Show the unsaved template indicator
 */
function showUnsavedTemplateIndicator()
{
    const indicator = document.getElementById('template-file-indicator');
    const filePathEl = document.getElementById('template-file-path');
    const fileNameEl = document.getElementById('template-file-name');

    if (!indicator || !filePathEl || !fileNameEl) return;

    filePathEl.textContent = '';
    fileNameEl.textContent = 'Unsaved Template';
    fileNameEl.title = 'This template has not been saved yet';
    indicator.style.display = 'flex';
}

/**
 * Update the unsaved state indicator for the template
 */
function updateTemplateUnsavedIndicator()
{
    const indicator = document.getElementById('template-file-indicator');
    const fileNameEl = document.getElementById('template-file-name');

    if (!indicator || !fileNameEl) return;

    if (hasUnsavedChanges)
    {
        indicator.classList.add('unsaved');
        if (!fileNameEl.textContent.includes('*'))
        {
            fileNameEl.textContent += ' *';
        }
    }
    else
    {
        indicator.classList.remove('unsaved');
        fileNameEl.textContent = fileNameEl.textContent.replace(' *', '');
    }
}

// Export functions for use by other modules
window.updateTemplateFileIndicator = updateTemplateFileIndicator;
window.showUnsavedTemplateIndicator = showUnsavedTemplateIndicator;
window.updateTemplateUnsavedIndicator = updateTemplateUnsavedIndicator;

// ============================================================================
// TEMPLATE JOYSTICK MAPPING
// ============================================================================

