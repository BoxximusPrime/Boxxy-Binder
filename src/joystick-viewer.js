const { invoke } = window.__TAURI__.core;
const { open, save } = window.__TAURI__.dialog;

// Import shared rendering utilities
import
{
    ButtonFrameWidth,
    ButtonFrameHeight,
    HatFrameWidth,
    HatFrameHeight,
    HatSpacing,
    simplifyButtonName,
    drawConnectingLine,
    drawButtonMarker,
    drawButtonBox,
    getHat4WayPositions,
    getHat2WayVerticalPositions,
    getHat2WayHorizontalPositions,
    drawHat4WayBoxes,
    drawHat2WayVerticalBoxes,
    drawHat2WayHorizontalBoxes,
    roundRect
} from './button-renderer.js';
import
{
    drawToggle3WayBoxes,
    drawRotaryBoxes,
    getToggle3WayPositions,
    getRotaryPositions
} from './input-type-renderer.js';
import { toStarCitizenFormat, getInputType } from './input-utils.js';

// ========================================
// Configurable Display Settings
// ========================================

// Default values from button-renderer constants
const DEFAULT_CONFIG = {
    frameWidth: 220,
    frameHeight: 120,
    hatWidth: 140,
    hatHeight: 100,
    numLines: 5,
    titleSize: 16,
    contentSize: 14,
    greenDefaults: false // When true, show default bindings in green instead of grey
};

// Current configuration (will be loaded from localStorage or use defaults)
let displayConfig = { ...DEFAULT_CONFIG };

// ========================================
// State Management
// ========================================

// Multi-template support
let loadedTemplates = []; // Array of { template: templateData, fileName: string }
let currentTemplateIndex = 0; // Index of currently selected template in loadedTemplates

// Template and bindings (currentTemplate is now derived from loadedTemplates)
let currentTemplate = null;
let currentBindings = null;

// Canvas elements
let canvas, ctx;

// UI state
let selectedButton = null;
let selectedBox = null; // Track the currently selected/clicked box for highlighting
let isPulsing = false; // Whether the current highlight should pulse
let highlightTimeout = null; // Timeout for clearing external highlights
let clickableBoxes = []; // Track clickable binding boxes for mouse events
let dragHoverBox = null; // Track drag-hover box during action drag-and-drop
let inputDragState = null; // Track input drag state for reverse drag
let isInputDragging = false;
let inputDragGhostEl = null;
let inputDragStart = null;
let inputDragSuppressClick = false;
let actionDropTarget = null;

// Live input highlight state
let liveInputBox = null;
let liveInputHighlightTimeout = null;
let viewerInputUnlisten = null;
let viewerDetectionLoop = null;
let isViewerInputDetectionActive = false;

// View transform
let zoom = 1.0;
let pan = { x: 0, y: 0 };
let isPanning = false;
let lastPanPosition = { x: 0, y: 0 };
let panMouseButton = null;
let panSuppressContextMenu = false;
let panSuppressContextMenuUntil = 0;
let panPointerId = null;
let panContextMenuTimeout = null;

// Filter state
let currentPageIndex = 0; // Currently viewing page index
let hideDefaultBindings = false; // Filter to hide default bindings
let modifierFilter = 'all'; // Current modifier filter: 'all', 'lalt', 'lctrl', etc.
let smartFilter = 'all'; // Smart filter: 'all', 'on-foot', 'spaceship', 'turret', 'vehicle'

// Smart filter category mappings
let categoryFriendlyNames = {};
let categoryMappingsLoaded = false;
let actionMapCategoryCache = new Map();

// Export bounds tracking
let drawBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

// ========================================
// Constants
// ========================================

// Drawing modes
const DrawMode = {
    NORMAL: 'normal',
    EXPORT: 'export',
    BOUNDS_ONLY: 'bounds_only'
};

// ========================================
// Utility Functions
// ========================================

// Helper to get current joystick number
function getCurrentJoystickNumber()
{
    const template = getCurrentTemplate();
    if (!template) return 1;

    // New pages structure with devicePrefix (v1.1+)
    if (template.pages && template.pages[currentPageIndex])
    {
        const page = template.pages[currentPageIndex];

        // Extract number from device_prefix (snake_case) or devicePrefix (camelCase)
        const prefix = page.device_prefix || page.devicePrefix;
        if (prefix)
        {
            const match = prefix.match(/\d+/);
            if (match)
            {
                return parseInt(match[0], 10);
            }
        }

        // Fallback to old joystickNumber field
        return page.joystickNumber || 1;
    }

    // Fallback for legacy structure
    const currentStickData = currentPageIndex === 0 ? template.leftStick : template.rightStick;

    if (currentStickData)
    {
        // Check for device_prefix or devicePrefix first
        const prefix = currentStickData.device_prefix || currentStickData.devicePrefix;
        if (prefix)
        {
            const match = prefix.match(/\d+/);
            if (match)
            {
                return parseInt(match[0], 10);
            }
        }

        // Fallback to joystickNumber
        if (currentStickData.joystickNumber)
        {
            return currentStickData.joystickNumber;
        }
    }

    return template.joystickNumber || 1;
}

/**
 * Get the current active template from the loadedTemplates array
 * @returns {Object|null} The current template data or null if none loaded
 */
function getCurrentTemplate()
{
    if (loadedTemplates.length === 0) return null;
    if (currentTemplateIndex < 0 || currentTemplateIndex >= loadedTemplates.length) return null;
    return loadedTemplates[currentTemplateIndex].template;
}

/**
 * Get the device prefix for the current page (e.g., "js1", "js2", "gp1")
 * Returns the full prefix string to prepend to button/axis names
 */
function getCurrentDevicePrefix()
{
    const template = getCurrentTemplate();
    if (!template) return 'js1';

    // New pages structure with devicePrefix (v1.1+)
    if (template.pages && template.pages[currentPageIndex])
    {
        const page = template.pages[currentPageIndex];

        // Use device_prefix (snake_case) or devicePrefix (camelCase) if available
        const prefix = page.device_prefix || page.devicePrefix;
        if (prefix)
        {
            return prefix;
        }

        // Fallback to constructing from joystickNumber
        const jsNum = page.joystickNumber || 1;
        return `js${jsNum}`;
    }

    // Fallback for legacy structure
    const currentStickData = currentPageIndex === 0 ? template.leftStick : template.rightStick;

    if (currentStickData)
    {
        const prefix = currentStickData.device_prefix || currentStickData.devicePrefix;
        if (prefix)
        {
            return prefix;
        }

        const jsNum = currentStickData.joystickNumber || 1;
        return `js${jsNum}`;
    }

    const jsNum = template.joystickNumber || 1;
    return `js${jsNum}`;
}

function normalizeInputStringForStick(rawInput, jsPrefix)
{
    if (!rawInput || typeof rawInput !== 'string')
    {
        return null;
    }

    const trimmed = rawInput.trim();
    if (!trimmed)
    {
        return null;
    }

    let normalized = trimmed.toLowerCase();

    // Convert to SC axis naming when possible
    const scFormat = toStarCitizenFormat(normalized);
    if (scFormat && typeof scFormat === 'string')
    {
        normalized = scFormat.toLowerCase();
    }

    if (jsPrefix)
    {
        if (normalized.match(/^(js|gp)\d+_/))
        {
            normalized = normalized.replace(/^(js|gp)\d+_/, jsPrefix);
        }
        else if (normalized.startsWith('axis') || normalized.startsWith('button'))
        {
            normalized = `${jsPrefix}${normalized}`;
        }
    }

    return normalized;
}

// Normalize template data to current format (handles legacy formats)
function normalizeTemplateData(templateData)
{
    // Handle old format: convert buttons array to rightStick
    if (templateData.buttons && !templateData.rightStick)
    {
        templateData.rightStick = { joystickNumber: 2, buttons: templateData.buttons };
        templateData.leftStick = { joystickNumber: 1, buttons: [] };
    }
    // Ensure nested structure has buttons array
    else if (templateData.leftStick || templateData.rightStick)
    {
        if (templateData.leftStick && typeof templateData.leftStick === 'object' &&
            !Array.isArray(templateData.leftStick) && !templateData.leftStick.buttons)
        {
            templateData.leftStick.buttons = [];
        }
        if (templateData.rightStick && typeof templateData.rightStick === 'object' &&
            !Array.isArray(templateData.rightStick) && !templateData.rightStick.buttons)
        {
            templateData.rightStick.buttons = [];
        }
    }

    // Handle old imageFlipped boolean format
    if (typeof templateData.imageFlipped === 'boolean')
    {
        templateData.imageFlipped = templateData.imageFlipped ? 'left' : 'right';
    }

    return templateData;
}

// ========================================
// Smart Filter Category Helpers
// ========================================

async function loadCategoryMappingsIfNeeded()
{
    if (categoryMappingsLoaded) return;

    try
    {
        const response = await fetch(new URL('../Categories.json', import.meta.url).href);
        if (!response.ok)
        {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        categoryFriendlyNames = await response.json();
    }
    catch (error)
    {
        console.error('Error loading Categories.json for viewer:', error);
        categoryFriendlyNames = {};
    }
    finally
    {
        categoryMappingsLoaded = true;
    }
}

function normalizeCategoryToken(value)
{
    if (!value || typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return normalized || null;
}

function addCategoryTokens(targetSet, value)
{
    if (Array.isArray(value))
    {
        value.forEach(item =>
        {
            const token = normalizeCategoryToken(item);
            if (token) targetSet.add(token);
        });
        return;
    }

    const token = normalizeCategoryToken(value);
    if (token) targetSet.add(token);
}

function buildActionMapCategoryCache()
{
    actionMapCategoryCache = new Map();

    if (!currentBindings || !currentBindings.action_maps) return;

    currentBindings.action_maps.forEach(actionMap =>
    {
        const tokens = new Set();
        const lookupKeys = [];

        if (actionMap.ui_category) lookupKeys.push(actionMap.ui_category);
        if (actionMap.name) lookupKeys.push(actionMap.name);
        if (actionMap.display_name) lookupKeys.push(actionMap.display_name);
        if (actionMap.ui_label) lookupKeys.push(actionMap.ui_label);

        lookupKeys.forEach(key =>
        {
            if (!key || typeof key !== 'string') return;

            let mapped = categoryFriendlyNames[key];
            if (!mapped)
            {
                mapped = categoryFriendlyNames[key.toLowerCase()];
            }
            if (mapped)
            {
                addCategoryTokens(tokens, mapped);
            }
        });

        const smartTags = new Set();
        const tokenList = Array.from(tokens);

        if (tokenList.includes('on foot')) smartTags.add('on-foot');
        if (tokenList.includes('turrets') || tokenList.includes('turret')) smartTags.add('turret');
        if (tokenList.includes('vehicle')) smartTags.add('vehicle');

        const mapName = (actionMap.name || '').toLowerCase();
        if (actionMap.ui_category === '@ui_CCSpaceFlight' || mapName.startsWith('spaceship_'))
        {
            smartTags.add('spaceship');
        }

        actionMapCategoryCache.set(actionMap.name, {
            tokens: tokenList,
            smartTags: Array.from(smartTags)
        });
    });
}

function getActionMapCategoryMeta(actionMap)
{
    if (!actionMap || !actionMap.name) return { tokens: [], smartTags: [] };
    return actionMapCategoryCache.get(actionMap.name) || { tokens: [], smartTags: [] };
}

function restoreSmartFilterSelection()
{
    const savedFilter = localStorage.getItem('viewerSmartFilter');
    if (savedFilter)
    {
        smartFilter = savedFilter;
    }

    const radio = document.querySelector(`input[name="smart-filter"][value="${smartFilter}"]`);
    if (radio)
    {
        radio.checked = true;
    }
}

// ========================================
// Initialization
// ========================================

// Export initialization function for tab system
window.initializeVisualView = function ()
{
    if (canvas) return; // Already initialized

    canvas = document.getElementById('viewer-canvas');
    ctx = canvas.getContext('2d');

    // Load display configuration from localStorage
    loadDisplayConfig();

    restoreSmartFilterSelection();

    initializeEventListeners();
    loadCurrentBindings();
    restoreViewState();
    loadPersistedTemplate();

    // Set up resize listener
    window.addEventListener('resize', resizeViewerCanvas);

    // Listen for theme changes to refresh canvas
    document.addEventListener('themechange', () =>
    {
        console.log('Theme changed, refreshing canvas...');
        if (getCurrentTemplate() && window.viewerImage)
        {
            resizeViewerCanvas();
        }
    });

    // Listen for page visibility changes to refresh bindings when returning
    document.addEventListener('visibilitychange', async () =>
    {
        if (!document.hidden)
        {
            console.log('Page became visible, refreshing bindings...');
            // Page is now visible - reload bindings in case they changed
            await loadCurrentBindings();
            console.log('Bindings reloaded, action maps:', currentBindings?.action_maps?.length);
            if (getCurrentTemplate() && window.viewerImage)
            {
                console.log('Redrawing canvas with updated bindings');
                if (!shouldPreserveViewerTransform())
                {
                    centerViewOnImage();
                }
                resizeViewerCanvas();
                drawButtons(window.viewerImage);
            }
            else
            {
                console.log('Template or image not loaded yet');
            }
        }
    });

    // Listen for storage events from template editor (cross-tab communication)
    window.addEventListener('storage', (event) =>
    {
        if (event.key === 'editorCurrentTemplate' && event.newValue)
        {
            // Template editor saved a template - check if it matches our current template
            try
            {
                const savedTemplate = JSON.parse(event.newValue);
                const savedFileName = localStorage.getItem('editorTemplateFileName');

                // Check if the saved template matches any of our loaded templates
                const matchingIndex = loadedTemplates.findIndex(t => t.fileName === savedFileName);
                if (matchingIndex !== -1)
                {
                    console.log(`[VIEWER] Template "${savedFileName}" was updated in editor, auto-reloading...`);
                    loadedTemplates[matchingIndex].template = normalizeTemplateData(savedTemplate);
                    saveLoadedTemplates();

                    if (matchingIndex === currentTemplateIndex)
                    {
                        displayTemplate();
                    }

                    // Set flag to notify editor that viewer was updated
                    localStorage.setItem('viewerWasUpdated', 'true');
                }
            }
            catch (error)
            {
                console.error('[VIEWER] Error processing storage event:', error);
            }
        }
    });

    // Start live input detection for the currently shown device
    startViewerInputDetection();
};

function initializeEventListeners()
{
    // Page selector buttons - will be populated dynamically when template loads
    const pageSelectorContainer = document.getElementById('viewer-stick-selector');
    if (pageSelectorContainer)
    {
        pageSelectorContainer.addEventListener('click', (e) =>
        {
            const btn = e.target.closest('[data-page-index]');
            if (btn)
            {
                const pageIndex = parseInt(btn.dataset.pageIndex, 10);
                switchPage(pageIndex);
            }
        });
    }

    // Tab key to navigate pages
    document.addEventListener('keydown', (e) =>
    {
        const template = getCurrentTemplate();
        if (e.key === 'Tab' && template && template.pages)
        {
            e.preventDefault(); // Prevent default tab focus behavior
            const maxPages = template.pages.length;
            if (maxPages > 1)
            {
                const direction = e.shiftKey ? -1 : 1; // Shift+Tab goes back, Tab goes forward
                const nextPageIndex = (currentPageIndex + direction + maxPages) % maxPages;
                switchPage(nextPageIndex);
            }
        }
    });

    // Hide defaults toggle button
    const hideDefaultsBtn = document.getElementById('hide-defaults-toggle');
    if (hideDefaultsBtn)
    {
        hideDefaultsBtn.addEventListener('click', () =>
        {
            hideDefaultBindings = !hideDefaultBindings;
            updateHideDefaultsButton();
            // Save preference
            ViewerState.saveViewState();
            // Redraw canvas
            if (window.viewerImage)
            {
                resizeViewerCanvas();
            }
            // Also refresh keyboard view if visible
            if (typeof window.refreshKeyboardView === 'function')
            {
                window.refreshKeyboardView();
            }
        });
    }

    // Modifier filter radios
    document.querySelectorAll('input[name="modifier-filter"]').forEach(radio =>
    {
        radio.addEventListener('change', (e) =>
        {
            modifierFilter = e.target.value;
            // Save preference
            ViewerState.saveViewState();
            // Redraw canvas
            if (window.viewerImage)
            {
                resizeViewerCanvas();
            }
            // Also refresh keyboard view if visible
            if (typeof window.refreshKeyboardView === 'function')
            {
                window.refreshKeyboardView();
            }
        });
    });

    // Smart filter radios
    document.querySelectorAll('input[name="smart-filter"]').forEach(radio =>
    {
        radio.addEventListener('change', (e) =>
        {
            smartFilter = e.target.value;
            localStorage.setItem('viewerSmartFilter', smartFilter);

            // Redraw canvas
            if (window.viewerImage)
            {
                resizeViewerCanvas();
            }

            if (selectedButton)
            {
                const bindings = searchBindings(extractButtonIdentifier(
                    selectedButton.buttonData,
                    selectedButton.buttonData.direction || null
                ));
                showBindingInfo(selectedButton.buttonData, bindings);
            }
        });
    });

    const selectTemplateBtn = document.getElementById('select-template-btn');
    if (selectTemplateBtn) selectTemplateBtn.addEventListener('click', openTemplateModal);

    const welcomeSelectBtn = document.getElementById('welcome-select-btn');
    if (welcomeSelectBtn) welcomeSelectBtn.addEventListener('click', openTemplateModal);

    const exportImageBtn = document.getElementById('export-image-btn');
    if (exportImageBtn) exportImageBtn.addEventListener('click', exportToImage);

    // Config button
    const configBtn = document.getElementById('viewer-config-btn');
    if (configBtn) configBtn.addEventListener('click', openConfigModal);

    // Modal
    const templateModalCancel = document.getElementById('template-modal-cancel');
    if (templateModalCancel) templateModalCancel.addEventListener('click', closeTemplateModal);

    // File input
    const templateFileInput = document.getElementById('template-file-input');
    if (templateFileInput) templateFileInput.addEventListener('change', onTemplateFileSelected);

    // Canvas click for selecting bindings
    if (canvas)
    {
        canvas.addEventListener('click', onCanvasClick);
        canvas.addEventListener('mousemove', onCanvasMouseMove);
        canvas.addEventListener('mousedown', onCanvasMouseDown);
        canvas.addEventListener('mouseup', onCanvasMouseUp);
        canvas.addEventListener('contextmenu', onCanvasContextMenu);
        canvas.addEventListener('wheel', onCanvasWheel, { passive: false });
        canvas.addEventListener('pointerdown', onCanvasPointerDown);
        canvas.addEventListener('pointermove', onCanvasPointerMove);
        canvas.addEventListener('pointerup', onCanvasPointerUp);
        canvas.addEventListener('pointercancel', onCanvasPointerCancel);
    }
}

// ========================================
// Live Input Detection (Viewer Highlight)
// ========================================

function startViewerInputDetection()
{
    if (isViewerInputDetectionActive) return;

    isViewerInputDetectionActive = true;

    if (window.__TAURI__?.event?.listen)
    {
        window.__TAURI__.event.listen('input-detected', (event) =>
        {
            if (!isViewerInputDetectionActive) return;
            if (!event || !event.payload) return;
            handleViewerInputDetected(event.payload);
        }).then(unlisten =>
        {
            viewerInputUnlisten = unlisten;
        }).catch(error =>
        {
            console.error('[Joystick Viewer] Failed to listen for input-detected events:', error);
        });
    }

    runViewerDetectionLoop();
}

function stopViewerInputDetection()
{
    isViewerInputDetectionActive = false;
    if (viewerDetectionLoop)
    {
        clearTimeout(viewerDetectionLoop);
        viewerDetectionLoop = null;
    }
    if (viewerInputUnlisten)
    {
        viewerInputUnlisten();
        viewerInputUnlisten = null;
    }
}

async function runViewerDetectionLoop()
{
    if (!isViewerInputDetectionActive) return;

    try
    {
        await invoke('wait_for_inputs_with_events', {
            sessionId: 'viewer-live-highlight',
            initialTimeoutSecs: 60,
            collectDurationSecs: 60
        });
    } catch (error)
    {
        console.warn('[Joystick Viewer] Live input detection loop error:', error);
    }

    if (isViewerInputDetectionActive)
    {
        viewerDetectionLoop = setTimeout(runViewerDetectionLoop, 10);
    }
}

function handleViewerInputDetected(inputData)
{
    if (!inputData || !inputData.input_string) return;
    if (!window.viewerImage || !getCurrentTemplate()) return;

    const inputType = getInputType(inputData.input_string);
    if (inputType !== 'button') return;

    let mappedInput = inputData.input_string;
    if (inputData.device_uuid && typeof window.applyDevicePrefixOverride === 'function')
    {
        mappedInput = window.applyDevicePrefixOverride(inputData.input_string, inputData.device_uuid);
    }

    const currentPrefix = getCurrentDevicePrefix().toLowerCase();
    const prefixMatch = mappedInput.match(/^(js|gp)\d+/i);
    if (!prefixMatch) return;

    const inputPrefix = prefixMatch[0].toLowerCase();
    if (inputPrefix !== currentPrefix) return;

    const matchingBox = findMatchingBoxForInput(mappedInput);
    if (matchingBox)
    {
        highlightLiveInputBox(matchingBox);
    }
}

function findMatchingBoxForInput(bindingInput)
{
    const targetInput = bindingInput.toLowerCase().trim();

    for (const box of clickableBoxes)
    {
        if (box.bindings && Array.isArray(box.bindings))
        {
            const hasMatch = box.bindings.some(binding =>
            {
                if (binding && typeof binding === 'object')
                {
                    if (binding.inputRaw && binding.inputRaw.toLowerCase().trim() === targetInput) return true;
                    if (binding.input && binding.input.toLowerCase().trim() === targetInput) return true;
                }
                if (typeof binding === 'string' && binding.toLowerCase().trim() === targetInput) return true;
                return false;
            });

            if (hasMatch) return box;
        }

        if (box.buttonData)
        {
            try
            {
                const info = extractButtonIdentifier(box.buttonData);
                if (info.inputString && info.inputString.toLowerCase() === targetInput) return box;
                if (info.buttonNum !== null && info.jsPrefix)
                {
                    const constructedInput = `${info.jsPrefix}button${info.buttonNum}`.toLowerCase();
                    if (constructedInput === targetInput) return box;
                }
            } catch (e)
            {
                // Ignore errors during extraction
            }
        }
    }

    return null;
}

function highlightLiveInputBox(box)
{
    liveInputBox = box;

    if (liveInputHighlightTimeout)
    {
        clearTimeout(liveInputHighlightTimeout);
    }

    liveInputHighlightTimeout = setTimeout(() =>
    {
        liveInputBox = null;
        resizeViewerCanvas();
        liveInputHighlightTimeout = null;
    }, 350);

    resizeViewerCanvas();
}

async function loadCurrentBindings()
{
    try
    {
        await loadCategoryMappingsIfNeeded();

        // Always get fresh merged bindings from backend (AllBinds + user customizations)
        // No need to cache - backend is the single source of truth
        console.log('Loading bindings from backend');
        currentBindings = await invoke('get_merged_bindings');
        console.log('Loaded bindings from backend with', currentBindings.action_maps?.length, 'action maps');
        buildActionMapCategoryCache();
    } catch (error)
    {
        console.log('Error loading merged bindings:', error);
        currentBindings = null;
    }
}

// Refresh visual view bindings when switching back to this tab
window.refreshVisualView = async function (preserveView = false)
{
    try
    {
        await loadCurrentBindings();
        // Redraw canvas if template is loaded
        if (window.viewerImage && getCurrentTemplate())
        {
            const shouldPreserve = preserveView || shouldPreserveViewerTransform();

            // Only center the view if not preserving the current pan/zoom
            if (!shouldPreserve)
            {
                centerViewOnImage();
            }
            resizeViewerCanvas();
        }
        // Also refresh keyboard view if visible
        if (typeof window.refreshKeyboardView === 'function')
        {
            window.refreshKeyboardView();
        }
    } catch (error)
    {
        console.error('Error refreshing visual view:', error);
    }
};

// Template selection
async function openTemplateModal()
{
    // For now, just open file dialog
    // In the future, we could maintain a library of templates
    document.getElementById('template-file-input').click();
}

function closeTemplateModal()
{
    document.getElementById('template-modal').style.display = 'none';
}

async function onTemplateFileSelected(e)
{
    const file = e.target.files[0];
    if (!file) return;

    try
    {
        const text = await file.text();
        const templateData = normalizeTemplateData(JSON.parse(text));

        // Check if this template is already loaded (by filename)
        const existingIndex = loadedTemplates.findIndex(t => t.fileName === file.name);

        if (existingIndex !== -1)
        {
            // Update existing template and select it
            loadedTemplates[existingIndex].template = templateData;
            currentTemplateIndex = existingIndex;
        }
        else
        {
            // Add new template to the array
            loadedTemplates.push({
                template: templateData,
                fileName: file.name
            });
            currentTemplateIndex = loadedTemplates.length - 1;
        }

        // Reset page index when switching templates
        currentPageIndex = 0;

        // Persist to localStorage
        saveLoadedTemplates();

        // Update template tabs UI
        updateTemplateTabs();

        displayTemplate();

    } catch (error)
    {
        console.error('Error loading template:', error);
        await window.showAlert(`Failed to load template: ${error}`, 'Error');
    }

    // Clear the input
    e.target.value = '';
}

function restoreViewState()
{
    try
    {
        const currentBindingsView = localStorage.getItem('bindingsView') || 'list';
        // Restore current page index (use viewer-specific key)
        const savedPageIndex = localStorage.getItem('viewerCurrentPageIndex');
        if (savedPageIndex !== null)
        {
            currentPageIndex = parseInt(savedPageIndex, 10) || 0;
        }

        // Restore hide defaults preference (use viewer-specific key)
        const savedHideDefaults = localStorage.getItem('viewerHideDefaultBindings');
        if (savedHideDefaults !== null)
        {
            hideDefaultBindings = savedHideDefaults === 'true';
            updateHideDefaultsButton();
        }

        // Restore modifier filter preference (use viewer-specific key)
        const savedModifierFilter = localStorage.getItem('viewerModifierFilter');
        if (savedModifierFilter)
        {
            modifierFilter = savedModifierFilter;
            const radio = document.querySelector(`input[name="modifier-filter"][value="${savedModifierFilter}"]`);
            if (radio)
            {
                radio.checked = true;
            }
        }

        restoreViewerTransformForView(currentBindingsView, true);
    }
    catch (error)
    {
        console.error('Error restoring view state:', error);
    }
}

function getViewerTransformStorageKeys(viewName)
{
    const normalizedView = viewName === 'split' ? 'split' : 'visual';
    return {
        panKey: `viewerPan_${normalizedView}`,
        zoomKey: `viewerZoom_${normalizedView}`
    };
}

function restoreViewerTransformForView(viewName, allowLegacy = false)
{
    const { panKey, zoomKey } = getViewerTransformStorageKeys(viewName);

    let savedPan = ViewerState.load(panKey);
    let savedZoom = localStorage.getItem(zoomKey);
    let usedLegacy = false;

    if ((!savedPan && !savedZoom) && allowLegacy)
    {
        savedPan = ViewerState.load('viewerPan');
        savedZoom = localStorage.getItem('viewerZoom');
        usedLegacy = Boolean(savedPan || savedZoom);
    }

    if (savedPan)
    {
        pan.x = savedPan.x || 0;
        pan.y = savedPan.y || 0;
    }

    if (savedZoom)
    {
        zoom = parseFloat(savedZoom);
        if (isNaN(zoom) || zoom < 0.1 || zoom > 5)
        {
            zoom = 1.0; // Reset to default if invalid
        }
    }

    if (usedLegacy)
    {
        ViewerState.save(panKey, pan);
        localStorage.setItem(zoomKey, zoom.toString());
    }
}

window.restoreViewerTransformForCurrentView = function ()
{
    const currentView = localStorage.getItem('bindingsView') || 'list';
    restoreViewerTransformForView(currentView, true);
};

function shouldPreserveViewerTransform()
{
    const currentView = localStorage.getItem('bindingsView') || 'list';
    const { panKey, zoomKey } = getViewerTransformStorageKeys(currentView);
    const savedPan = ViewerState.load(panKey);
    const savedZoom = localStorage.getItem(zoomKey);

    if (savedPan || savedZoom)
    {
        return true;
    }

    // Fallback to legacy keys
    const legacyPan = ViewerState.load('viewerPan');
    const legacyZoom = localStorage.getItem('viewerZoom');

    return Boolean(legacyPan || legacyZoom);
}

function updateHideDefaultsButton()
{
    const btn = document.getElementById('hide-defaults-toggle');
    if (btn)
    {
        if (hideDefaultBindings)
        {
            btn.classList.add('active');
            btn.querySelector('span:not(.control-icon)').textContent = 'Custom Only';
        }
        else
        {
            btn.classList.remove('active');
            btn.querySelector('span:not(.control-icon)').textContent = 'Show All';
        }
    }
}

function centerViewOnImage()
{
    if (!window.viewerImage || !canvas) return;

    const container = document.getElementById('viewer-canvas-container');
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const containerCenterX = rect.width / 2;
    const containerCenterY = rect.height / 2;

    const imageCenterX = window.viewerImage.width / 2;
    const imageCenterY = window.viewerImage.height / 2;

    pan.x = containerCenterX - (imageCenterX * zoom);
    pan.y = containerCenterY - (imageCenterY * zoom);

    ViewerState.saveViewState();
}

function loadPersistedTemplate()
{
    try
    {
        // Load multi-template array from localStorage
        const savedTemplates = ViewerState.load('viewerLoadedTemplates');
        const savedTemplateIndex = localStorage.getItem('viewerCurrentTemplateIndex');

        if (savedTemplates && Array.isArray(savedTemplates) && savedTemplates.length > 0)
        {
            // Restore multi-template state
            loadedTemplates = savedTemplates.map(t => ({
                template: normalizeTemplateData(t.template),
                fileName: t.fileName
            }));

            currentTemplateIndex = savedTemplateIndex !== null ? parseInt(savedTemplateIndex, 10) : 0;
            if (currentTemplateIndex < 0 || currentTemplateIndex >= loadedTemplates.length)
            {
                currentTemplateIndex = 0;
            }

            // Validate currentPageIndex against available pages
            const template = getCurrentTemplate();
            let maxPages = 0;
            if (template)
            {
                if (template.pages && template.pages.length > 0)
                {
                    maxPages = template.pages.length;
                }
                else if (template.leftStick || template.rightStick)
                {
                    maxPages = 2; // Legacy dual-stick
                }
            }

            if (currentPageIndex >= maxPages)
            {
                currentPageIndex = 0;
            }

            // Update template tabs UI
            updateTemplateTabs();

            displayTemplate();
        }
        else
        {
            // Try legacy single-template format for backwards compatibility
            const savedTemplate = ViewerState.load('viewerCurrentTemplate');
            if (savedTemplate)
            {
                const normalizedTemplate = normalizeTemplateData(savedTemplate);
                const savedFileName = localStorage.getItem('viewerTemplateFileName') || 'Untitled Template';

                loadedTemplates = [{
                    template: normalizedTemplate,
                    fileName: savedFileName
                }];
                currentTemplateIndex = 0;

                // Validate currentPageIndex
                let maxPages = 0;
                if (normalizedTemplate.pages && normalizedTemplate.pages.length > 0)
                {
                    maxPages = normalizedTemplate.pages.length;
                }
                else if (normalizedTemplate.leftStick || normalizedTemplate.rightStick)
                {
                    maxPages = 2;
                }

                if (currentPageIndex >= maxPages)
                {
                    currentPageIndex = 0;
                }

                // Migrate to new format
                saveLoadedTemplates();
                updateTemplateTabs();
                displayTemplate();
            }
            else if (window.showNoTemplateIndicator)
            {
                // No template loaded - show no template indicator
                window.showNoTemplateIndicator();
            }
        }
    } catch (error)
    {
        console.error('Error loading persisted template:', error);
    }
}

// ========================================
// Multi-Template Management Functions
// ========================================

/**
 * Save loaded templates to localStorage
 */
function saveLoadedTemplates()
{
    ViewerState.save('viewerLoadedTemplates', loadedTemplates);
    localStorage.setItem('viewerCurrentTemplateIndex', currentTemplateIndex.toString());
}

/**
 * Switch to a different loaded template
 * @param {number} index - Index in loadedTemplates array
 */
function switchTemplate(index)
{
    if (index < 0 || index >= loadedTemplates.length) return;
    if (index === currentTemplateIndex) return;

    currentTemplateIndex = index;
    currentPageIndex = 0; // Reset to first page when switching templates

    saveLoadedTemplates();
    ViewerState.saveViewState();

    updateTemplateTabs();
    displayTemplate();
}

/**
 * Close/remove a loaded template
 * @param {number} index - Index in loadedTemplates array
 */
function closeTemplate(index)
{
    if (index < 0 || index >= loadedTemplates.length) return;

    loadedTemplates.splice(index, 1);

    // Adjust currentTemplateIndex if needed
    if (loadedTemplates.length === 0)
    {
        currentTemplateIndex = 0;
        currentPageIndex = 0;
        saveLoadedTemplates();
        updateTemplateTabs();

        // Show welcome screen
        const welcomeScreen = document.getElementById('welcome-screen-visual');
        if (welcomeScreen) welcomeScreen.style.display = 'flex';

        const canvasContainer = document.getElementById('viewer-canvas-container');
        if (canvasContainer) canvasContainer.style.display = 'none';

        const viewerControls = document.getElementById('viewer-controls');
        if (viewerControls) viewerControls.style.display = 'none';

        const toolbar = document.getElementById('modifier-toolbar');
        if (toolbar) toolbar.style.display = 'none';

        if (window.showNoTemplateIndicator)
        {
            window.showNoTemplateIndicator();
        }
    }
    else
    {
        // Select the previous template or stay at same index
        if (currentTemplateIndex >= loadedTemplates.length)
        {
            currentTemplateIndex = loadedTemplates.length - 1;
        }
        else if (currentTemplateIndex > index)
        {
            currentTemplateIndex--;
        }

        currentPageIndex = 0;
        saveLoadedTemplates();
        updateTemplateTabs();
        displayTemplate();
    }
}

/**
 * Update the template tabs UI in the toolbar
 */
function updateTemplateTabs()
{
    const templateTabsContainer = document.getElementById('viewer-template-tabs');
    if (!templateTabsContainer) return;

    const templateTabsDivider = document.querySelector('.template-tabs-divider');
    templateTabsContainer.innerHTML = '';

    if (loadedTemplates.length === 0)
    {
        templateTabsContainer.style.display = 'none';
        if (templateTabsDivider) templateTabsDivider.style.display = 'none';
        return;
    }

    templateTabsContainer.style.display = 'flex';
    if (templateTabsDivider) templateTabsDivider.style.display = 'block';

    loadedTemplates.forEach((templateInfo, index) =>
    {
        const tab = document.createElement('div');
        tab.className = 'template-tab' + (index === currentTemplateIndex ? ' active' : '');
        tab.dataset.templateIndex = index;

        // Truncate filename if too long
        const displayName = templateInfo.fileName.length > 20
            ? templateInfo.fileName.substring(0, 17) + '...'
            : templateInfo.fileName;

        tab.innerHTML = `
            <span class="template-tab-name" title="${templateInfo.fileName}">${displayName}</span>
            <button class="template-tab-close" title="Close template" data-close-index="${index}">×</button>
        `;

        // Click to select template
        tab.addEventListener('click', (e) =>
        {
            if (!e.target.classList.contains('template-tab-close'))
            {
                switchTemplate(index);
            }
        });

        // Close button
        const closeBtn = tab.querySelector('.template-tab-close');
        closeBtn.addEventListener('click', (e) =>
        {
            e.stopPropagation();
            closeTemplate(index);
        });

        templateTabsContainer.appendChild(tab);
    });
}

// Page switching
function switchPage(pageIndex)
{
    const template = getCurrentTemplate();
    if (!template || !template.pages || pageIndex < 0 || pageIndex >= template.pages.length)
    {
        return;
    }

    if (currentPageIndex === pageIndex) return;

    currentPageIndex = pageIndex;

    // Save to localStorage
    ViewerState.saveViewState();

    // Update button states
    updatePageSelectorButtons();

    // Load image for new page
    loadPageImage();
}

// Get current page's button array
function getCurrentButtons()
{
    const template = getCurrentTemplate();
    if (!template) return [];

    // New pages structure
    if (template.pages && template.pages[currentPageIndex])
    {
        return template.pages[currentPageIndex].buttons || [];
    }

    // Legacy support: Handle old format with single buttons array
    if (template.buttons && !template.rightStick)
    {
        return currentPageIndex === 0 ? [] : template.buttons;
    }

    // Legacy support: Get the appropriate stick
    const stick = currentPageIndex === 0 ? template.leftStick : template.rightStick;

    // Handle nested structure: { joystickNumber: 1, buttons: [...] }
    if (stick && typeof stick === 'object' && !Array.isArray(stick))
    {
        return stick.buttons || [];
    }

    // Handle flat array structure: [...]
    return stick || [];
}

function displayTemplate()
{
    const template = getCurrentTemplate();
    if (!template) return;

    // Helper to check if stick has buttons
    const hasButtons = (stick) =>
    {
        if (!stick) return false;
        if (Array.isArray(stick)) return stick.length > 0;
        if (stick.buttons && Array.isArray(stick.buttons)) return stick.buttons.length > 0;
        return false;
    };

    // Show/hide stick selector based on whether it's a dual stick template
    const isDualStick = (template.leftStick || template.rightStick) &&
        (hasButtons(template.leftStick) || hasButtons(template.rightStick));

    const selectorEl = document.getElementById('viewer-stick-selector');
    if (isDualStick)
    {
        selectorEl.style.display = 'flex';
    }
    else
    {
        selectorEl.style.display = 'none';
    }

    // Hide welcome screen and show canvas container with controls
    const welcomeScreen = document.getElementById('welcome-screen-visual');
    if (welcomeScreen) welcomeScreen.style.display = 'none';

    const canvasContainer = document.getElementById('viewer-canvas-container');
    if (canvasContainer) canvasContainer.style.display = 'flex';

    const viewerControls = document.getElementById('viewer-controls');
    if (viewerControls) viewerControls.style.display = 'flex';

    // Update hide defaults button
    updateHideDefaultsButton();

    // Show modifier toolbar
    const toolbar = document.getElementById('modifier-toolbar');
    if (toolbar)
    {
        toolbar.style.display = 'flex';
    }

    // Create page selector buttons
    createPageSelectorButtons();

    // Load the image for the current page
    loadPageImage();
}

function createPageSelectorButtons()
{
    const selectorEl = document.getElementById('viewer-stick-selector');
    if (!selectorEl) return;

    // Clear existing buttons
    selectorEl.innerHTML = '';

    const template = getCurrentTemplate();
    if (!template) return;

    // Determine number of pages
    let pages = [];
    if (template.pages && template.pages.length > 0)
    {
        // New multi-page structure
        pages = template.pages;
    }
    else
    {
        // Legacy dual-stick structure
        const hasLeftStick = template.leftStick &&
            (Array.isArray(template.leftStick) ? template.leftStick.length > 0 :
                template.leftStick.buttons && template.leftStick.buttons.length > 0);
        const hasRightStick = template.rightStick &&
            (Array.isArray(template.rightStick) ? template.rightStick.length > 0 :
                template.rightStick.buttons && template.rightStick.buttons.length > 0);

        if (hasLeftStick)
        {
            pages.push({ name: 'Left Stick' });
        }
        if (hasRightStick)
        {
            pages.push({ name: 'Right Stick' });
        }
    }

    // Show selector only if multiple pages
    if (pages.length <= 1)
    {
        selectorEl.style.display = 'none';
        return;
    }

    selectorEl.style.display = 'flex';

    // Create button for each page
    pages.forEach((page, index) =>
    {
        const btn = document.createElement('button');
        btn.className = 'control-btn';
        if (index === currentPageIndex)
        {
            btn.classList.add('active');
        }
        btn.dataset.pageIndex = index;
        btn.title = `View ${page.name}`;

        const icon = document.createElement('span');
        icon.className = 'control-icon';
        icon.textContent = '🕹️';
        btn.appendChild(icon);

        const text = document.createElement('span');
        text.textContent = page.name;
        btn.appendChild(text);

        selectorEl.appendChild(btn);
    });
}

function updatePageSelectorButtons()
{
    const selectorEl = document.getElementById('viewer-stick-selector');
    if (!selectorEl) return;

    const buttons = selectorEl.querySelectorAll('[data-page-index]');
    buttons.forEach((btn, index) =>
    {
        btn.classList.toggle('active', index === currentPageIndex);
    });
}

function loadPageImage()
{
    const template = getCurrentTemplate();
    if (!template) return;

    let imageDataUrl = null;
    let imageFlipped = false;

    // New pages structure
    if (template.pages && template.pages[currentPageIndex])
    {
        const currentPage = template.pages[currentPageIndex];

        // Check if this page mirrors another page's image
        if (currentPage.mirror_from_page_id)
        {
            const sourcePage = template.pages.find(p => p.id === currentPage.mirror_from_page_id);
            if (sourcePage && sourcePage.image_data_url)
            {
                imageDataUrl = sourcePage.image_data_url;
                imageFlipped = true; // Mirrored pages should be flipped
            }
        }
        else if (currentPage.image_data_url)
        {
            imageDataUrl = currentPage.image_data_url;
        }
    }
    else
    {
        // Legacy structure
        imageDataUrl = template.imageDataUrl;
        imageFlipped = (template.imageFlipped === currentPageIndex);
    }

    if (imageDataUrl)
    {
        // Load the image
        const img = new Image();
        img.onload = () =>
        {
            // Store image reference for resize handling
            window.viewerImage = img;
            window.viewerImageFlipped = imageFlipped;

            if (!shouldPreserveViewerTransform())
            {
                centerViewOnImage();
            }

            // Resize canvas to container and draw
            resizeViewerCanvas();
        };

        img.src = imageDataUrl;
    }
    else
    {
        // No image for this page - render without background
        window.viewerImage = null;
        window.viewerImageFlipped = false;

        // Still resize canvas and draw buttons
        resizeViewerCanvas();
    }
}

function resizeViewerCanvas()
{
    const container = document.getElementById('viewer-canvas-container');
    if (!container) return;

    const rect = container.getBoundingClientRect();

    // Set CSS size for display
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    // Set internal resolution with device pixel ratio
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Reset bounds tracking for export
    resetDrawBounds();

    // Draw everything
    ctx.save();

    // Apply DPR scaling first
    ctx.scale(dpr, dpr);

    // Apply zoom and pan
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw the image with flip based on stored flip state (if image exists)
    if (window.viewerImage)
    {
        ctx.save();
        const shouldFlip = window.viewerImageFlipped || false;

        if (shouldFlip)
        {
            ctx.translate(window.viewerImage.width, 0);
            ctx.scale(-1, 1);
        }
        ctx.drawImage(window.viewerImage, 0, 0);
        ctx.restore();
    }

    // Draw all buttons with their bindings (without flip)
    // Don't track bounds for normal drawing - we need to populate clickable boxes
    drawButtons(window.viewerImage);

    // Draw highlight border around selected box if any
    if (selectedBox)
    {
        if (isPulsing)
        {
            const highlightColor = '#ffffff'; // Pure white for pulsing

            // Pulse effect based on time
            const pulse = (Math.sin(Date.now() / 200) + 1) / 2; // 0 to 1
            const glowSize = 10 + (pulse * 15);
            const alpha = 0.6 + (pulse * 0.4);

            ctx.save();

            // Outer glow
            ctx.shadowBlur = glowSize;
            ctx.shadowColor = highlightColor;
            ctx.strokeStyle = highlightColor;
            ctx.lineWidth = 5;

            // Draw multiple rings for "obviousness"
            for (let i = 0; i < 3; i++)
            {
                const offset = i * 3;
                roundRect(ctx, selectedBox.x - 5 - offset, selectedBox.y - 5 - offset, selectedBox.width + 10 + (offset * 2), selectedBox.height + 10 + (offset * 2), 10);
                ctx.globalAlpha = alpha / (i + 1);
                ctx.stroke();
            }

            ctx.restore();

            // Request next frame for animation
            requestAnimationFrame(resizeViewerCanvas);
        }
        else
        {
            // Static selection - match template-editor.js style
            ctx.save();
            const accentHover = getComputedStyle(document.documentElement).getPropertyValue('--accent-hover').trim();
            ctx.strokeStyle = accentHover;
            ctx.lineWidth = 3;

            // Draw a single clean outline around the box
            // We add a small padding (2px) to make it look like a selection frame
            roundRect(ctx, selectedBox.x - 2, selectedBox.y - 2, selectedBox.width + 4, selectedBox.height + 4, 4);
            ctx.stroke();

            ctx.restore();
        }
    }

    // Draw live input highlight (short pulse on detected button)
    if (liveInputBox)
    {
        ctx.save();
        const accentPrimary = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim() || '#4a9eff';
        ctx.strokeStyle = accentPrimary;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 12;
        ctx.shadowColor = accentPrimary;
        roundRect(ctx, liveInputBox.x - 3, liveInputBox.y - 3, liveInputBox.width + 6, liveInputBox.height + 6, 6);
        ctx.stroke();
        ctx.restore();
    }

    // Draw drag-hover outline (action drag over input)
    if (dragHoverBox)
    {
        ctx.save();
        const accentPrimary = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim() || '#4a9eff';
        ctx.strokeStyle = accentPrimary;
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 4]);
        roundRect(ctx, dragHoverBox.x - 3, dragHoverBox.y - 3, dragHoverBox.width + 6, dragHoverBox.height + 6, 6);
        ctx.stroke();
        ctx.restore();
    }

    ctx.restore();
}

// Helper function to update bounds during drawing
function updateBounds(x, y, width = 0, height = 0)
{
    drawBounds.minX = Math.min(drawBounds.minX, x - width / 2);
    drawBounds.minY = Math.min(drawBounds.minY, y - height / 2);
    drawBounds.maxX = Math.max(drawBounds.maxX, x + width / 2);
    drawBounds.maxY = Math.max(drawBounds.maxY, y + height / 2);
}


// ========================================
// Button Drawing Functions
// ========================================

function drawButtons(img, mode = DrawMode.NORMAL)
{
    // Clear clickable boxes array (only in normal mode)
    if (mode === DrawMode.NORMAL)
    {
        clickableBoxes = [];
    }

    const buttons = getCurrentButtons();

    // First pass: draw all connecting lines
    buttons.forEach(button =>
    {
        if (button.labelPos)
        {
            drawConnectingLineForButton(button, mode);
        }
    });

    // Second pass: draw all buttons/markers/boxes
    buttons.forEach(button =>
    {
        // Check if this is a hat
        if (button.buttonType === 'hat4way')
        {
            drawHat4Way(button, mode);
        }
        else if (button.buttonType === 'hat2way-vertical')
        {
            drawHat2WayVertical(button, mode);
        }
        else if (button.buttonType === 'hat2way-horizontal')
        {
            drawHat2WayHorizontal(button, mode);
        }
        else if (button.buttonType === 'toggle3way-vertical')
        {
            drawToggle3WayVertical(button, mode);
        }
        else if (button.buttonType === 'toggle3way-horizontal')
        {
            drawToggle3WayHorizontal(button, mode);
        }
        else if (button.buttonType === 'rotary3way')
        {
            drawRotary3Way(button, mode);
        }
        else if (button.buttonType === 'rotary4way')
        {
            drawRotary4Way(button, mode);
        }
        else
        {
            drawSingleButton(button, mode);
        }
    });
}

function bindingsToContentLines(bindings)
{
    const safeBindings = Array.isArray(bindings) ? bindings : [];
    if (safeBindings.length === 0)
    {
        const hiddenCount = bindings && typeof bindings.hiddenCount === 'number' ? bindings.hiddenCount : 0;
        if (hiddenCount > 0)
        {
            const label = hiddenCount === 1 ? '1 hidden' : `${hiddenCount} hidden`;
            return [`[muted]${label}`];
        }
        return [];
    }

    return safeBindings.map(binding =>
    {
        let actionLabel = binding.actionLabel || binding.action;
        if (binding.multiTap && binding.multiTap > 1)
        {
            actionLabel += ` (${binding.multiTap}x)`;
        }

        if (binding.isDefault && !displayConfig.greenDefaults)
        {
            return `[muted]${actionLabel}`;
        }
        return `[action]${actionLabel}`;
    });
}

// Helper function to draw connecting line for a button (first pass)
function drawConnectingLineForButton(button, mode = DrawMode.NORMAL)
{
    if (mode === DrawMode.BOUNDS_ONLY) return; // Skip lines in bounds-only mode

    const isMultiInput = button.buttonType && (
        button.buttonType.startsWith('hat') ||
        button.buttonType === 'toggle3way-vertical' ||
        button.buttonType === 'toggle3way-horizontal' ||
        button.buttonType === 'rotary3way' ||
        button.buttonType === 'rotary4way'
    );
    let bindings;

    if (button.buttonType === 'hat4way')
    {
        bindings = findAllBindingsForHatDirection(button, 'up');
    }
    else if (button.buttonType === 'hat2way-vertical')
    {
        bindings = findAllBindingsForHatDirection(button, 'up');
    }
    else if (button.buttonType === 'hat2way-horizontal')
    {
        bindings = findAllBindingsForHatDirection(button, 'left');
    }
    else if (button.buttonType === 'toggle3way-vertical')
    {
        bindings = findAllBindingsForHatDirection(button, 'up');
    }
    else if (button.buttonType === 'toggle3way-horizontal')
    {
        bindings = findAllBindingsForHatDirection(button, 'left');
    }
    else if (button.buttonType === 'rotary3way' || button.buttonType === 'rotary4way')
    {
        bindings = findAllBindingsForHatDirection(button, '1');
    }
    else
    {
        bindings = findAllBindingsForButton(button);
    }

    const accentPrimary = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim();
    const textMuted = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim();
    const lineColor = bindings.length > 0 ? accentPrimary : textMuted;

    drawConnectingLine(ctx, button.buttonPos, button.labelPos, displayConfig.frameWidth / 2, lineColor, isMultiInput);
}

function drawToggle3WayVertical(toggle, mode = DrawMode.NORMAL)
{
    const directions = ['up', 'middle', 'down'];
    const positions = getToggle3WayPositions(toggle.labelPos.x, toggle.labelPos.y, 'vertical', displayConfig.hatWidth, displayConfig.hatHeight);

    if (mode === DrawMode.BOUNDS_ONLY)
    {
        updateBounds(toggle.buttonPos.x, toggle.buttonPos.y, 12, 12);
        directions.forEach(dir =>
        {
            if (toggle.inputs && toggle.inputs[dir])
            {
                const pos = positions[dir];
                updateBounds(pos.x, pos.y, displayConfig.hatWidth, displayConfig.hatHeight);
            }
        });
        return;
    }

    drawButtonMarker(ctx, toggle.buttonPos, 1, false, true);

    const onClickableBox = (box) =>
    {
        if (mode === DrawMode.NORMAL)
        {
            clickableBoxes.push(box);
        }
    };

    const bindingsByDirection = {};
    directions.forEach(dir =>
    {
        if (toggle.inputs && toggle.inputs[dir])
        {
            bindingsByDirection[dir] = findAllBindingsForHatDirection(toggle, dir);
        }
    });

    drawToggle3WayBoxes(ctx, toggle, {
        mode,
        alpha: 1,
        orientation: 'vertical',
        getContentForDirection: (dir) => bindingsToContentLines(bindingsByDirection[dir] || []),
        colors: {
            titleColor: '#aaa',
            contentColor: '#ddd',
            subtleColor: '#999',
            mutedColor: '#888',
            actionColor: '#7dd3c0'
        },
        onClickableBox,
        bindingsByDirection,
        buttonDataForDirection: (dir) => ({ ...toggle, direction: dir }),
        hatFrameWidth: displayConfig.hatWidth,
        hatFrameHeight: displayConfig.hatHeight,
        numLines: displayConfig.numLines,
        titleFontSize: displayConfig.titleSize + 'px',
        contentFontSize: displayConfig.contentSize + 'px'
    });
}

function drawToggle3WayHorizontal(toggle, mode = DrawMode.NORMAL)
{
    const directions = ['left', 'middle', 'right'];
    const positions = getToggle3WayPositions(toggle.labelPos.x, toggle.labelPos.y, 'horizontal', displayConfig.hatWidth, displayConfig.hatHeight);

    if (mode === DrawMode.BOUNDS_ONLY)
    {
        updateBounds(toggle.buttonPos.x, toggle.buttonPos.y, 12, 12);
        directions.forEach(dir =>
        {
            if (toggle.inputs && toggle.inputs[dir])
            {
                const pos = positions[dir];
                updateBounds(pos.x, pos.y, displayConfig.hatWidth, displayConfig.hatHeight);
            }
        });
        return;
    }

    drawButtonMarker(ctx, toggle.buttonPos, 1, false, true);

    const onClickableBox = (box) =>
    {
        if (mode === DrawMode.NORMAL)
        {
            clickableBoxes.push(box);
        }
    };

    const bindingsByDirection = {};
    directions.forEach(dir =>
    {
        if (toggle.inputs && toggle.inputs[dir])
        {
            bindingsByDirection[dir] = findAllBindingsForHatDirection(toggle, dir);
        }
    });

    drawToggle3WayBoxes(ctx, toggle, {
        mode,
        alpha: 1,
        orientation: 'horizontal',
        getContentForDirection: (dir) => bindingsToContentLines(bindingsByDirection[dir] || []),
        colors: {
            titleColor: '#aaa',
            contentColor: '#ddd',
            subtleColor: '#999',
            mutedColor: '#888',
            actionColor: '#7dd3c0'
        },
        onClickableBox,
        bindingsByDirection,
        buttonDataForDirection: (dir) => ({ ...toggle, direction: dir }),
        hatFrameWidth: displayConfig.hatWidth,
        hatFrameHeight: displayConfig.hatHeight,
        numLines: displayConfig.numLines,
        titleFontSize: displayConfig.titleSize + 'px',
        contentFontSize: displayConfig.contentSize + 'px'
    });
}

function drawRotary3Way(rotary, mode = DrawMode.NORMAL)
{
    drawRotaryInternal(rotary, mode, 3);
}

function drawRotary4Way(rotary, mode = DrawMode.NORMAL)
{
    drawRotaryInternal(rotary, mode, 4);
}

function drawRotaryInternal(rotary, mode, steps)
{
    const baseDirections = [];
    for (let i = 1; i <= steps; i++) baseDirections.push(String(i));
    const includePush = true;
    const hasPush = includePush && rotary.inputs && rotary.inputs.push;

    const positions = getRotaryPositions(rotary.labelPos.x, rotary.labelPos.y, steps, hasPush, displayConfig.hatWidth, displayConfig.hatHeight);

    if (mode === DrawMode.BOUNDS_ONLY)
    {
        updateBounds(rotary.buttonPos.x, rotary.buttonPos.y, 12, 12);
        baseDirections.forEach(dir =>
        {
            if (rotary.inputs && rotary.inputs[dir])
            {
                const pos = positions[dir];
                updateBounds(pos.x, pos.y, displayConfig.hatWidth, displayConfig.hatHeight);
            }
        });
        if (hasPush)
        {
            const pos = positions.push;
            updateBounds(pos.x, pos.y, displayConfig.hatWidth, displayConfig.hatHeight);
        }
        return;
    }

    drawButtonMarker(ctx, rotary.buttonPos, 1, false, true);

    const onClickableBox = (box) =>
    {
        if (mode === DrawMode.NORMAL)
        {
            clickableBoxes.push(box);
        }
    };

    const bindingsByDirection = {};
    baseDirections.forEach(dir =>
    {
        if (rotary.inputs && rotary.inputs[dir])
        {
            bindingsByDirection[dir] = findAllBindingsForHatDirection(rotary, dir);
        }
    });
    if (hasPush)
    {
        bindingsByDirection.push = findAllBindingsForHatDirection(rotary, 'push');
    }

    drawRotaryBoxes(ctx, rotary, {
        mode,
        alpha: 1,
        steps,
        includePush: true,
        getContentForDirection: (dir) => bindingsToContentLines(bindingsByDirection[dir] || []),
        colors: {
            titleColor: '#aaa',
            contentColor: '#ddd',
            subtleColor: '#999',
            mutedColor: '#888',
            actionColor: '#7dd3c0'
        },
        onClickableBox,
        bindingsByDirection,
        buttonDataForDirection: (dir) => ({ ...rotary, direction: dir }),
        hatFrameWidth: displayConfig.hatWidth,
        hatFrameHeight: displayConfig.hatHeight,
        numLines: displayConfig.numLines,
        titleFontSize: displayConfig.titleSize + 'px',
        contentFontSize: displayConfig.contentSize + 'px'
    });
}

function drawSingleButton(button, mode = DrawMode.NORMAL)
{
    // Find ALL bindings for this button
    const bindings = findAllBindingsForButton(button);

    // Only track bounds in bounds mode
    if (mode === DrawMode.BOUNDS_ONLY)
    {
        if (bindings.length > 0)
        {
            updateBounds(button.buttonPos.x, button.buttonPos.y, 14, 14);
        }
        if (button.labelPos)
        {
            updateBounds(button.labelPos.x, button.labelPos.y, displayConfig.frameWidth, displayConfig.frameHeight);
        }
        return;
    }

    // Note: Lines are now drawn in a separate pass (drawConnectingLineForButton)
    // This ensures button frames are always drawn on top of lines

    // Draw button position marker
    drawButtonMarker(ctx, button.buttonPos, 1, bindings.length > 0, false);

    // Draw label box with binding info
    if (button.labelPos)
    {
        drawBindingBoxLocal(button.labelPos.x, button.labelPos.y, simplifyButtonName(button.name), bindings, false, button, mode);
    }
}

function drawHat4Way(hat, mode = DrawMode.NORMAL)
{
    // Hat has 5 directions: up, down, left, right, push
    const directions = ['up', 'down', 'left', 'right', 'push'];

    // Check if push button exists
    const hasPush = hat.inputs && hat.inputs['push'];

    // Use centralized position calculation for consistency with template editor
    const positions = getHat4WayPositions(hat.labelPos.x, hat.labelPos.y, hasPush, displayConfig.hatWidth, displayConfig.hatHeight);

    // Only track bounds in bounds mode
    if (mode === DrawMode.BOUNDS_ONLY)
    {
        updateBounds(hat.buttonPos.x, hat.buttonPos.y, 12, 12);
        directions.forEach(dir =>
        {
            if (hat.inputs && hat.inputs[dir])
            {
                const pos = positions[dir];
                updateBounds(pos.x, pos.y, displayConfig.hatWidth, displayConfig.hatHeight);
            }
        });

        // Calculate title position using same logic as drawHat4WayBoxes
        const boxHalfHeight = displayConfig.hatHeight / 2;
        const verticalDistanceWithPush = boxHalfHeight + HatSpacing + boxHalfHeight;
        const verticalDistanceNoPush = (displayConfig.hatHeight + HatSpacing) / 2;
        const verticalDistance = hasPush ? verticalDistanceWithPush + (HatSpacing + HatSpacing / 2) : verticalDistanceNoPush + HatSpacing;
        const titleGap = 12;
        const titleY = hat.labelPos.y - verticalDistance - boxHalfHeight - titleGap;

        const textWidth = 60; // Approximate
        updateBounds(hat.labelPos.x, titleY, textWidth, 13);
        return;
    }

    // Draw center point marker
    drawButtonMarker(ctx, hat.buttonPos, 1, false, true);

    // Note: Hat connecting line is now drawn in drawConnectingLineForButton (first pass)
    // This ensures button frames are always drawn on top of lines

    // Callback to register clickable boxes
    const onClickableBox = (box) =>
    {
        if (mode === DrawMode.NORMAL)
        {
            clickableBoxes.push(box);
        }
    };

    // Store bindings by direction for passing to clickable boxes
    const bindingsByDirection = {};
    const directionsList = ['up', 'down', 'left', 'right', 'push'];
    directionsList.forEach(dir =>
    {
        if (hat.inputs && hat.inputs[dir])
        {
            bindingsByDirection[dir] = findAllBindingsForHatDirection(hat, dir);
        }
    });

    // Use unified rendering function with joystick viewer styling
    drawHat4WayBoxes(ctx, hat, {
        mode: mode,
        alpha: 1,
        getContentForDirection: (dir, input) =>
        {
            const bindings = bindingsByDirection[dir] || [];
            return bindingsToContentLines(bindings);
        },
        colors: {
            titleColor: '#aaa',
            contentColor: '#ddd',
            subtleColor: '#999',
            mutedColor: '#888',
            actionColor: '#7dd3c0'
        },
        onClickableBox: onClickableBox,
        bindingsByDirection: bindingsByDirection,
        buttonDataForDirection: (dir) => ({ ...hat, direction: dir }),
        // Pass display configuration
        hatFrameWidth: displayConfig.hatWidth,
        hatFrameHeight: displayConfig.hatHeight,
        numLines: displayConfig.numLines,
        titleFontSize: displayConfig.titleSize + 'px',
        contentFontSize: displayConfig.contentSize + 'px'
    });
}

function drawHat2WayVertical(hat, mode = DrawMode.NORMAL)
{
    // Hat has 3 directions: up, down, push
    const directions = ['up', 'down', 'push'];

    // Check if push button exists
    const hasPush = hat.inputs && hat.inputs['push'];

    // Use centralized position calculation
    const positions = getHat2WayVerticalPositions(hat.labelPos.x, hat.labelPos.y, hasPush, displayConfig.hatWidth, displayConfig.hatHeight);

    // Only track bounds in bounds mode
    if (mode === DrawMode.BOUNDS_ONLY)
    {
        updateBounds(hat.buttonPos.x, hat.buttonPos.y, 12, 12);
        directions.forEach(dir =>
        {
            if (hat.inputs && hat.inputs[dir])
            {
                const pos = positions[dir];
                updateBounds(pos.x, pos.y, displayConfig.hatWidth, displayConfig.hatHeight);
            }
        });

        const boxHalfHeight = displayConfig.hatHeight / 2;
        const verticalDistanceWithPush = boxHalfHeight + HatSpacing + boxHalfHeight;
        const verticalDistanceNoPush = (displayConfig.hatHeight + HatSpacing) / 2;
        const verticalDistance = hasPush ? verticalDistanceWithPush + (HatSpacing + HatSpacing / 2) : verticalDistanceNoPush + HatSpacing;
        const titleGap = 12;
        const titleY = hat.labelPos.y - verticalDistance - boxHalfHeight - titleGap;

        const textWidth = 60;
        updateBounds(hat.labelPos.x, titleY, textWidth, 13);
        return;
    }

    // Draw center point marker
    drawButtonMarker(ctx, hat.buttonPos, 1, false, true);

    // Callback to register clickable boxes
    const onClickableBox = (box) =>
    {
        if (mode === DrawMode.NORMAL)
        {
            clickableBoxes.push(box);
        }
    };

    // Store bindings by direction
    const bindingsByDirection = {};
    directions.forEach(dir =>
    {
        if (hat.inputs && hat.inputs[dir])
        {
            bindingsByDirection[dir] = findAllBindingsForHatDirection(hat, dir);
        }
    });

    // Use unified rendering function with joystick viewer styling
    drawHat2WayVerticalBoxes(ctx, hat, {
        mode: mode,
        alpha: 1,
        getContentForDirection: (dir, input) =>
        {
            const bindings = bindingsByDirection[dir] || [];
            return bindingsToContentLines(bindings);
        },
        colors: {
            titleColor: '#aaa',
            contentColor: '#ddd',
            subtleColor: '#999',
            mutedColor: '#888',
            actionColor: '#7dd3c0'
        },
        onClickableBox: onClickableBox,
        bindingsByDirection: bindingsByDirection,
        buttonDataForDirection: (dir) => ({ ...hat, direction: dir }),
        // Pass display configuration
        hatFrameWidth: displayConfig.hatWidth,
        hatFrameHeight: displayConfig.hatHeight,
        numLines: displayConfig.numLines,
        titleFontSize: displayConfig.titleSize + 'px',
        contentFontSize: displayConfig.contentSize + 'px'
    });
}

function drawHat2WayHorizontal(hat, mode = DrawMode.NORMAL)
{
    // Hat has 3 directions: left, right, push
    const directions = ['left', 'right', 'push'];

    // Check if push button exists
    const hasPush = hat.inputs && hat.inputs['push'];

    // Use centralized position calculation
    const positions = getHat2WayHorizontalPositions(hat.labelPos.x, hat.labelPos.y, hasPush, displayConfig.hatWidth, displayConfig.hatHeight);

    // Only track bounds in bounds mode
    if (mode === DrawMode.BOUNDS_ONLY)
    {
        updateBounds(hat.buttonPos.x, hat.buttonPos.y, 12, 12);
        directions.forEach(dir =>
        {
            if (hat.inputs && hat.inputs[dir])
            {
                const pos = positions[dir];
                updateBounds(pos.x, pos.y, displayConfig.hatWidth, displayConfig.hatHeight);
            }
        });

        const titleGap = 12;
        const titleY = hat.labelPos.y - displayConfig.hatHeight - HatSpacing - titleGap;

        const textWidth = 60;
        updateBounds(hat.labelPos.x, titleY, textWidth, 13);
        return;
    }

    // Draw center point marker
    drawButtonMarker(ctx, hat.buttonPos, 1, false, true);

    // Callback to register clickable boxes
    const onClickableBox = (box) =>
    {
        if (mode === DrawMode.NORMAL)
        {
            clickableBoxes.push(box);
        }
    };

    // Store bindings by direction
    const bindingsByDirection = {};
    directions.forEach(dir =>
    {
        if (hat.inputs && hat.inputs[dir])
        {
            bindingsByDirection[dir] = findAllBindingsForHatDirection(hat, dir);
        }
    });

    // Use unified rendering function with joystick viewer styling
    drawHat2WayHorizontalBoxes(ctx, hat, {
        mode: mode,
        alpha: 1,
        getContentForDirection: (dir, input) =>
        {
            const bindings = bindingsByDirection[dir] || [];
            return bindingsToContentLines(bindings);
        },
        colors: {
            titleColor: '#aaa',
            contentColor: '#ddd',
            subtleColor: '#999',
            mutedColor: '#888',
            actionColor: '#7dd3c0'
        },
        onClickableBox: onClickableBox,
        bindingsByDirection: bindingsByDirection,
        buttonDataForDirection: (dir) => ({ ...hat, direction: dir }),
        // Pass display configuration
        hatFrameWidth: displayConfig.hatWidth,
        hatFrameHeight: displayConfig.hatHeight,
        numLines: displayConfig.numLines,
        titleFontSize: displayConfig.titleSize + 'px',
        contentFontSize: displayConfig.contentSize + 'px'
    });
}

// Local wrapper for shared drawBindingBox to handle clickable tracking and bounds
function drawBindingBoxLocal(x, y, label, bindings, compact = false, buttonData = null, mode = DrawMode.NORMAL)
{
    // Always update bounds in export mode
    if (mode === DrawMode.EXPORT)
    {
        const width = compact ? displayConfig.hatWidth : displayConfig.frameWidth;
        updateBounds(x, y, width, displayConfig.frameHeight);
    }

    // Callback to register clickable boxes
    const onClickableBox = (box) =>
    {
        if (mode === DrawMode.NORMAL)
        {
            clickableBoxes.push(box);
        }
    };

    const contentLines = bindingsToContentLines(bindings);

    // Use improved rendering function from button-renderer.js with display config
    drawButtonBox(ctx, x, y, label, contentLines, compact, {
        hasBinding: contentLines.length > 0,
        buttonData: buttonData,
        mode: mode,
        onClickableBox: onClickableBox,
        titleColor: '#ccc',
        contentColor: '#ddd',
        subtleColor: '#999',
        mutedColor: '#888',
        actionColor: '#7dd3c0',
        bindingsData: bindings,
        // Pass display configuration
        frameWidth: displayConfig.frameWidth,
        frameHeight: displayConfig.frameHeight,
        hatFrameWidth: displayConfig.hatWidth,
        hatFrameHeight: displayConfig.hatHeight,
        numLines: displayConfig.numLines,
        titleFontSize: displayConfig.titleSize + 'px',
        contentFontSize: displayConfig.contentSize + 'px'
    });
}

// Helper functions now imported from button-renderer.js

// ========================================
// Binding Search Functions
// ========================================

// Helper to extract button ID or input string from button data
/**
 * Specialized version of extractButtonIdentifier for searching across templates
 * This allows passing a specific devicePrefix instead of relying on global state
 */
function extractButtonIdentifierForSearch(button, devicePrefix, direction = null)
{
    const jsPrefix = `${devicePrefix}_`;
    let buttonNum = null;
    let inputString = null;

    // For hat direction, get the specific input for that direction
    if (direction && button.inputs && button.inputs[direction])
    {
        const dirInput = button.inputs[direction];
        if (typeof dirInput === 'string')
        {
            let processedInput = dirInput;
            if (!processedInput.match(/^(js|gp)\d+_/i))
            {
                processedInput = `${devicePrefix}_${processedInput}`;
            }
            inputString = normalizeInputStringForStick(processedInput, jsPrefix);
        }
        else if (typeof dirInput === 'object' && dirInput.id !== undefined)
        {
            buttonNum = dirInput.id;
        }
        return { buttonNum, inputString, jsPrefix };
    }

    if (button.buttonId !== undefined && button.buttonId !== null)
    {
        buttonNum = button.buttonId;
    }
    else if (button.inputs && button.inputs.main)
    {
        const main = button.inputs.main;
        if (typeof main === 'object' && main.id !== undefined)
        {
            if (main.type === 'axis')
            {
                const directionSuffix = main.direction ? `_${main.direction}` : '';
                const axisString = `${devicePrefix}_axis${main.id}${directionSuffix}`;
                inputString = normalizeInputStringForStick(axisString, jsPrefix);
            }
            else
            {
                buttonNum = main.id;
            }
        }
        else if (typeof main === 'string')
        {
            if (main.match(/^(x|y|z|rotx|roty|rotz|slider1|slider2)$/i))
            {
                inputString = `${jsPrefix}${main.toLowerCase()}`;
            }
            else
            {
                const withPrefix = main.includes('_') ? main : `${devicePrefix}_${main}`;
                inputString = normalizeInputStringForStick(withPrefix, jsPrefix);
            }
        }
    }
    else if (button.inputType === 'axis' && button.inputId !== undefined && button.inputId !== null)
    {
        if (typeof button.inputId === 'string' && button.inputId.match(/^(x|y|z|rotx|roty|rotz|slider1|slider2)$/i))
        {
            inputString = `${jsPrefix}${button.inputId.toLowerCase()}`;
        }
        else
        {
            const directionSuffix = button.axisDirection ? `_${button.axisDirection}` : '';
            const axisString = `${devicePrefix}_axis${button.inputId}${directionSuffix}`;
            inputString = normalizeInputStringForStick(axisString, jsPrefix);
        }
    }
    else if (button.inputType === 'button' && button.inputId !== undefined && button.inputId !== null)
    {
        buttonNum = button.inputId;
    }

    return { buttonNum, inputString, jsPrefix };
}

function extractButtonIdentifier(button, direction = null)
{
    const jsNum = getCurrentJoystickNumber();
    const devicePrefix = getCurrentDevicePrefix();
    const jsPrefix = `${devicePrefix}_`;

    let buttonNum = null;
    let inputString = null;

    // For hat direction, get the specific input for that direction
    if (direction && button.inputs && button.inputs[direction])
    {
        const dirInput = button.inputs[direction];

        if (typeof dirInput === 'string')
        {
            // For v1.1+ templates, hat inputs like "hat1_up" need the device prefix prepended
            // The hat number (1, 2, etc.) refers to the physical input and stays as-is
            let processedInput = dirInput;

            // Prepend devicePrefix if no underscore prefix already (plain button name or hat input)
            if (!processedInput.match(/^(js|gp)\d+_/i))
            {
                processedInput = `${devicePrefix}_${processedInput}`;
            }

            inputString = normalizeInputStringForStick(processedInput, jsPrefix);
        }
        else if (typeof dirInput === 'object' && dirInput.id !== undefined)
        {
            buttonNum = dirInput.id;
        }

        return { buttonNum, inputString, jsNum, jsPrefix };
    }

    // For regular buttons, use priority system:
    // 1. buttonId field (new simple format)
    // 2. inputs.main (legacy format with full SC string)
    // 3. Parse from button name (fallback)

    if (button.buttonId !== undefined && button.buttonId !== null)
    {
        buttonNum = button.buttonId;
    }
    else if (button.inputs && button.inputs.main)
    {
        const main = button.inputs.main;
        if (typeof main === 'object' && main.id !== undefined)
        {
            if (main.type === 'axis')
            {
                const directionSuffix = main.direction ? `_${main.direction}` : '';
                const axisString = `${devicePrefix}_axis${main.id}${directionSuffix}`;
                inputString = normalizeInputStringForStick(axisString, jsPrefix);
            }
            else
            {
                buttonNum = main.id;
            }
        }
        else if (typeof main === 'string')
        {
            // Check if this is an axis name (x, y, z, rotx, roty, rotz, slider1, slider2)
            if (main.match(/^(x|y|z|rotx|roty|rotz|slider1|slider2)$/i))
            {
                // Axis name - construct the full input string directly
                inputString = `${jsPrefix}${main.toLowerCase()}`;
            }
            else
            {
                // Button or other input - prepend devicePrefix if not already present
                const withPrefix = main.includes('_') ? main : `${devicePrefix}_${main}`;
                inputString = normalizeInputStringForStick(withPrefix, jsPrefix);
            }
        }
    }
    else if (button.inputType === 'axis' && button.inputId !== undefined && button.inputId !== null)
    {
        // inputId might be a number (legacy: 1, 2, 3) or a string (new: "x", "y", "z")
        if (typeof button.inputId === 'string' && button.inputId.match(/^(x|y|z|rotx|roty|rotz|slider1|slider2)$/i))
        {
            // Already a Star Citizen axis name - construct the full input string
            const axisName = button.inputId.toLowerCase();
            inputString = `${jsPrefix}${axisName}`;
        }
        else
        {
            // Legacy numeric format
            const directionSuffix = button.axisDirection ? `_${button.axisDirection}` : '';
            const axisString = `${devicePrefix}_axis${button.inputId}${directionSuffix}`;
            inputString = normalizeInputStringForStick(axisString, jsPrefix);
        }
    }
    else if (button.inputType === 'button' && button.inputId !== undefined && button.inputId !== null)
    {
        buttonNum = button.inputId;
    }
    else
    {
        // Fallback: Try to parse button number from name
        // BUT: Only do this if the name actually contains "button"
        // This prevents "Axis 2" from incorrectly matching "Button 2"
        const buttonName = button.name.toLowerCase();

        // Only extract button number if "button" is in the name
        if (buttonName.includes('button'))
        {
            let match = buttonName.match(/button\((\d+)\)/);
            if (match)
            {
                buttonNum = parseInt(match[1]);
            }
            else
            {
                match = buttonName.match(/button\s+(\d+)/);
                if (match)
                {
                    buttonNum = parseInt(match[1]);
                }
                else
                {
                    const allNumbers = buttonName.match(/\d+/g);
                    if (allNumbers && allNumbers.length > 0)
                    {
                        buttonNum = parseInt(allNumbers[allNumbers.length - 1]);
                    }
                }
            }
        }
    }

    return { buttonNum, inputString, jsNum, jsPrefix };
}

// Unified function to search for all bindings matching a button identifier
function searchBindings(buttonIdentifier)
{
    if (!currentBindings) return [];

    if (actionMapCategoryCache.size === 0)
    {
        buildActionMapCategoryCache();
    }

    const { buttonNum, inputString, jsNum, jsPrefix } = buttonIdentifier;
    const allBindings = [];

    // Search through all action maps for ALL bindings that use this button
    for (const actionMap of currentBindings.action_maps)
    {
        const actionMapMeta = getActionMapCategoryMeta(actionMap);

        for (const action of actionMap.actions)
        {
            if (!action.bindings || action.bindings.length === 0) continue;

            for (let bindingIndex = 0; bindingIndex < action.bindings.length; bindingIndex++)
            {
                const binding = action.bindings[bindingIndex];
                if (binding.input_type === 'Joystick')
                {
                    let input = binding.input.toLowerCase();
                    let modifiers = [];
                    let inputWithoutModifier = input;

                    // Handle Star Citizen modifier format: js1_lalt+button3
                    // The modifier is AFTER the device prefix but BEFORE the button
                    // Format: {device}_{modifier}+{button} OR old format: {modifier}+{device}_{button}

                    // First, try the SC format: js1_lalt+button3
                    const scModifierMatch = input.match(/^(js\d+|gp\d+)_([a-z]+)\+(.+)$/i);
                    if (scModifierMatch)
                    {
                        const devicePrefix = scModifierMatch[1];
                        modifiers = [scModifierMatch[2]];
                        const buttonPart = scModifierMatch[3];
                        inputWithoutModifier = `${devicePrefix}_${buttonPart}`;
                    }
                    // Also handle legacy/alternate format: lalt+js1_button3
                    else if (input.includes('+'))
                    {
                        const plusIndex = input.indexOf('+');
                        const beforePlus = input.substring(0, plusIndex);
                        const afterPlus = input.substring(plusIndex + 1);

                        // Check if the part before + looks like a modifier (not a device prefix)
                        if (!beforePlus.match(/^(js|gp|kb|mo)\d+/i))
                        {
                            modifiers = [beforePlus];
                            inputWithoutModifier = afterPlus;
                        }
                    }

                    // Skip invalid/empty joystick bindings
                    if (!inputWithoutModifier || inputWithoutModifier.match(/^js\d+_\s*$/) || inputWithoutModifier.endsWith('_')) continue;

                    let isMatch = false;

                    // Exact match with input string (compare without modifiers)
                    if (inputString && (inputWithoutModifier === inputString || inputWithoutModifier.startsWith(inputString + '_')))
                    {
                        isMatch = true;
                    }
                    // For axis bindings, also try matching just the axis name (to handle default bindings)
                    // Default bindings from AllBinds.xml are hardcoded to js1_ in the backend,
                    // but they should apply to all joystick instances
                    else if (inputString && inputString.match(/_(?:x|y|z|rotx|roty|rotz|slider1|slider2)$/))
                    {
                        // Extract just the axis name from our inputString (e.g., "js2_x" -> "x")
                        const ourAxisName = inputString.split('_').pop();
                        // Extract axis name from the binding (e.g., "js1_x" -> "x")
                        const bindingAxisName = inputWithoutModifier.split('_').pop();
                        // If the axis names match and it's a default binding, consider it a match
                        if (ourAxisName === bindingAxisName && binding.is_default)
                        {
                            isMatch = true;
                        }
                    }
                    // Match by button number - BUT ONLY FOR ACTUAL BUTTONS, NOT AXES
                    // This prevents "axis2" from incorrectly matching "button2"
                    else if (buttonNum !== null)
                    {
                        // Only use button number matching if the binding is actually a button
                        // Check that it doesn't contain 'axis' or 'hat' to avoid false matches
                        const buttonPattern = new RegExp(`^${jsPrefix}button${buttonNum}(?:_|$)`);
                        if (buttonPattern.test(inputWithoutModifier) && !inputWithoutModifier.includes('_axis') && !inputWithoutModifier.includes('_hat'))
                        {
                            isMatch = true;
                        }
                    }

                    if (isMatch)
                    {
                        let actionLabel = action.ui_label || action.display_name || action.name;

                        if (modifiers.length > 0)
                        {
                            actionLabel = modifiers.join('+') + ' + ' + actionLabel;
                        }

                        if (action.on_hold)
                        {
                            actionLabel += ' (Hold)';
                        }

                        const mapLabel = actionMap.ui_label || actionMap.display_name || actionMap.name;

                        allBindings.push({
                            action: actionLabel,
                            actionName: action.name, // Internal action name for removal
                            actionMapName: actionMap.name, // Internal action map name for removal
                            input: binding.display_name,
                            inputRaw: binding.input, // Raw input string for removal
                            bindingIndex: bindingIndex, // Index of binding for removal
                            actionMap: mapLabel,
                            isDefault: binding.is_default,
                            modifiers: modifiers,
                            multiTap: binding.multi_tap,
                            activationMode: binding.activation_mode || null,
                            smartTags: actionMapMeta.smartTags
                        });
                    }
                }
            }
        }
    }

    // Sort and filter
    allBindings.sort((a, b) =>
    {
        if (a.isDefault === b.isDefault) return 0;
        return a.isDefault ? 1 : -1;
    });

    let filteredBindings = allBindings;

    if (hideDefaultBindings)
    {
        filteredBindings = filteredBindings.filter(b => !b.isDefault);
    }

    if (modifierFilter !== 'all')
    {
        filteredBindings = filteredBindings.filter(b =>
            b.modifiers && b.modifiers.includes(modifierFilter)
        );
    }

    if (smartFilter !== 'all')
    {
        filteredBindings = filteredBindings.filter(b =>
            b.smartTags && b.smartTags.includes(smartFilter)
        );
    }

    const hiddenCount = Math.max(0, allBindings.length - filteredBindings.length);
    filteredBindings.hiddenCount = hiddenCount;
    filteredBindings.totalCount = allBindings.length;

    return filteredBindings;
}

function findAllBindingsForButton(button)
{
    return searchBindings(extractButtonIdentifier(button));
}

function findAllBindingsForHatDirection(hat, direction)
{
    return searchBindings(extractButtonIdentifier(hat, direction));
}

// ========================================
// Canvas Mouse & Keyboard Interaction
// ========================================

function getCanvasCoords(event)
{
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Convert screen coordinates to canvas coordinates
    const canvasX = (event.clientX - rect.left);
    const canvasY = (event.clientY - rect.top);

    // Reverse the DPR scaling
    const scaledX = canvasX / dpr;
    const scaledY = canvasY / dpr;

    // Reverse the pan and zoom transformations
    const imgX = (scaledX - pan.x) / zoom;
    const imgY = (scaledY - pan.y) / zoom;

    return { x: imgX, y: imgY };
}

function findClickableBoxAtPoint(imgX, imgY)
{
    for (const box of clickableBoxes)
    {
        if (imgX >= box.x && imgX <= box.x + box.width &&
            imgY >= box.y && imgY <= box.y + box.height)
        {
            return box;
        }
    }
    return null;
}

function updateDragHoverFromEvent(event)
{
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const isInside = event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom;

    if (!isInside)
    {
        if (dragHoverBox)
        {
            dragHoverBox = null;
            resizeViewerCanvas();
        }
        return;
    }

    const coords = getCanvasCoords(event);
    const hoverBox = findClickableBoxAtPoint(coords.x, coords.y);

    if (hoverBox !== dragHoverBox)
    {
        dragHoverBox = hoverBox;
        resizeViewerCanvas();
    }
}

function clearDragHover()
{
    if (dragHoverBox)
    {
        dragHoverBox = null;
        resizeViewerCanvas();
    }
}

window.updateJoystickDragHover = updateDragHoverFromEvent;
window.clearJoystickDragHover = clearDragHover;

window.completeJoystickDragDrop = async function (actionMapName, actionName, event)
{
    if (!dragHoverBox)
    {
        clearDragHover();
        return false;
    }

    const inputString = getButtonIdString(dragHoverBox.buttonData);
    if (!inputString || inputString === 'Unknown')
    {
        clearDragHover();
        return false;
    }

    try
    {
        if (window.applyBinding)
        {
            await window.applyBinding(actionMapName, actionName, inputString, null, null);
            if (window.showSuccessMessage)
            {
                window.showSuccessMessage(`Bound ${actionName} → ${inputString}`);
            }
        }
        else
        {
            console.warn('applyBinding not available for drag-drop binding');
        }
    }
    catch (error)
    {
        console.error('Error binding action from drag-drop:', error);
        if (window.showAlert) await window.showAlert(`Error binding action: ${error}`, 'Error');
    }
    finally
    {
        clearDragHover();
    }

    return true;
};

function onCanvasMouseDown(event)
{
    // Middle click (button 1) or right click (button 2) for panning
    if (event.button === 1 || event.button === 2)
    {
        isPanning = true;
        lastPanPosition = { x: event.clientX, y: event.clientY };
        panMouseButton = event.button;
        panSuppressContextMenu = event.button === 2;
        canvas.style.cursor = 'grabbing';
        window.addEventListener('mousemove', onPanMouseMove, true);
        window.addEventListener('mouseup', onPanMouseUp, true);
        window.addEventListener('contextmenu', onPanContextMenu, true);
        if (panContextMenuTimeout)
        {
            clearTimeout(panContextMenuTimeout);
            panContextMenuTimeout = null;
        }
        event.preventDefault();
        return;
    }

    // Left click: potential drag from input box
    if (event.button === 0)
    {
        const currentView = localStorage.getItem('bindingsView') || 'list';
        if (currentView !== 'split') return;

        const coords = getCanvasCoords(event);
        const hoverBox = findClickableBoxAtPoint(coords.x, coords.y);
        if (hoverBox)
        {
            inputDragState = {
                box: hoverBox,
                startX: event.clientX,
                startY: event.clientY
            };
            inputDragStart = { x: event.clientX, y: event.clientY };
            event.preventDefault();
        }
    }
}

function onCanvasPointerDown(event)
{
    // Middle click (button 1) or right click (button 2) for panning
    if (event.button === 1 || event.button === 2)
    {
        isPanning = true;
        lastPanPosition = { x: event.clientX, y: event.clientY };
        panMouseButton = event.button;
        panSuppressContextMenu = event.button === 2;
        panPointerId = event.pointerId;
        canvas.style.cursor = 'grabbing';
        if (canvas.setPointerCapture)
        {
            canvas.setPointerCapture(event.pointerId);
        }
        window.addEventListener('contextmenu', onPanContextMenu, true);
        if (panContextMenuTimeout)
        {
            clearTimeout(panContextMenuTimeout);
            panContextMenuTimeout = null;
        }
        event.preventDefault();
    }
}

function onCanvasPointerMove(event)
{
    if (isPanning && panPointerId === event.pointerId)
    {
        onPanMouseMove(event);
        event.preventDefault();
    }
}

function onCanvasPointerUp(event)
{
    if (isPanning && panPointerId === event.pointerId)
    {
        stopPanning();
        event.preventDefault();
    }
}

function onCanvasPointerCancel(event)
{
    if (isPanning && panPointerId === event.pointerId)
    {
        stopPanning();
    }
}

function onPanMouseMove(event)
{
    if (!isPanning) return;

    if (panSuppressContextMenu)
    {
        event.preventDefault();
    }

    const deltaX = event.clientX - lastPanPosition.x;
    const deltaY = event.clientY - lastPanPosition.y;

    pan.x += deltaX;
    pan.y += deltaY;

    lastPanPosition = { x: event.clientX, y: event.clientY };
    resizeViewerCanvas();
}

function stopPanning()
{
    if (!isPanning) return;

    isPanning = false;
    panMouseButton = null;
    if (panPointerId !== null && canvas && canvas.releasePointerCapture)
    {
        try
        {
            if (canvas.hasPointerCapture && canvas.hasPointerCapture(panPointerId))
            {
                canvas.releasePointerCapture(panPointerId);
            }
        }
        catch (error)
        {
            console.warn('Failed to release pointer capture:', error);
        }
    }
    panPointerId = null;
    if (panSuppressContextMenu)
    {
        panSuppressContextMenuUntil = Date.now() + 500;
    }
    panSuppressContextMenu = false;
    canvas.style.cursor = 'default';

    window.removeEventListener('mousemove', onPanMouseMove, true);
    window.removeEventListener('mouseup', onPanMouseUp, true);
    if (panContextMenuTimeout)
    {
        clearTimeout(panContextMenuTimeout);
    }
    panContextMenuTimeout = setTimeout(() =>
    {
        window.removeEventListener('contextmenu', onPanContextMenu, true);
        panContextMenuTimeout = null;
    }, 600);

    // Save pan state to localStorage
    ViewerState.saveViewState();
}

function onPanMouseUp(event)
{
    if (!isPanning) return;
    if (panMouseButton !== null && event.button !== panMouseButton && event.buttons !== 0) return;
    stopPanning();
}

function onPanContextMenu(event)
{
    if (panSuppressContextMenu || Date.now() < panSuppressContextMenuUntil)
    {
        event.preventDefault();
    }
}

function onCanvasContextMenu(event)
{
    // Prevent right-click context menu when over canvas
    if (isPanning || panSuppressContextMenu || Date.now() < panSuppressContextMenuUntil || event.button === 2)
    {
        event.preventDefault();
    }
}

function onCanvasMouseUp(event)
{
    if (isPanning)
    {
        stopPanning();
        return;
    }

    if (isInputDragging)
    {
        finalizeInputDrag(event);
        return;
    }

    if (inputDragState)
    {
        inputDragState = null;
    }
}

function onCanvasWheel(event)
{
    event.preventDefault();
    const delta = -event.deltaY / 1000;
    zoomBy(delta, event);
}

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

    // Save zoom and pan state to localStorage
    ViewerState.saveViewState();

    resizeViewerCanvas();
}

// Canvas click handler
function onCanvasClick(event)
{
    if (inputDragSuppressClick)
    {
        inputDragSuppressClick = false;
        return;
    }

    const coords = getCanvasCoords(event);
    const imgX = coords.x;
    const imgY = coords.y;

    // Clear any existing highlight timeout if user clicks manually
    if (highlightTimeout)
    {
        clearTimeout(highlightTimeout);
        highlightTimeout = null;
    }

    // Check if click is within any clickable box (boxes are in image coordinates)
    for (const box of clickableBoxes)
    {
        if (imgX >= box.x && imgX <= box.x + box.width &&
            imgY >= box.y && imgY <= box.y + box.height)
        {
            selectedBox = box;
            isPulsing = false; // Static outline for manual clicks
            showBindingInfo(box.buttonData, box.bindings);
            resizeViewerCanvas();
            return;
        }
    }

    // Click outside any box - hide info panel and deselect
    hideBindingInfo();
} function onCanvasMouseMove(event)
{
    if (isPanning)
    {
        const deltaX = event.clientX - lastPanPosition.x;
        const deltaY = event.clientY - lastPanPosition.y;

        pan.x += deltaX;
        pan.y += deltaY;

        lastPanPosition = { x: event.clientX, y: event.clientY };
        resizeViewerCanvas();
        return;
    }

    if (inputDragState && !isInputDragging)
    {
        const dx = event.clientX - inputDragState.startX;
        const dy = event.clientY - inputDragState.startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > 5)
        {
            startInputDrag(event);
        }
    }

    if (isInputDragging)
    {
        updateInputDrag(event);
        return;
    }

    const coords = getCanvasCoords(event);
    const imgX = coords.x;
    const imgY = coords.y;

    // Check if hovering over any clickable box (boxes are in image coordinates)
    let isOverBox = false;
    for (const box of clickableBoxes)
    {
        if (imgX >= box.x && imgX <= box.x + box.width &&
            imgY >= box.y && imgY <= box.y + box.height)
        {
            isOverBox = true;
            break;
        }
    }

    canvas.style.cursor = isOverBox ? 'pointer' : 'default';
}

function startInputDrag(event)
{
    if (!inputDragState || !inputDragState.box) return;

    isInputDragging = true;
    inputDragSuppressClick = true;

    const inputString = getButtonIdString(inputDragState.box.buttonData);
    inputDragGhostEl = document.createElement('div');
    inputDragGhostEl.className = 'input-drag-ghost';
    inputDragGhostEl.textContent = inputString;
    document.body.appendChild(inputDragGhostEl);

    document.body.classList.add('is-input-dragging');
    updateInputDrag(event);

    document.addEventListener('mousemove', onInputDragMove, true);
    document.addEventListener('mouseup', onInputDragEnd, true);
}

function onInputDragMove(event)
{
    if (!isInputDragging) return;
    updateInputDrag(event);
}

function onInputDragEnd(event)
{
    if (!isInputDragging) return;
    finalizeInputDrag(event);
}

function updateInputDrag(event)
{
    if (!inputDragGhostEl) return;

    const offsetX = 12;
    const offsetY = 12;
    inputDragGhostEl.style.left = `${event.clientX + offsetX}px`;
    inputDragGhostEl.style.top = `${event.clientY + offsetY}px`;

    updateActionDropHover(event);
}

function updateActionDropHover(event)
{
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const actionItem = element ? element.closest('.action-item') : null;

    if (actionItem !== actionDropTarget)
    {
        if (actionDropTarget)
        {
            actionDropTarget.classList.remove('action-drop-hover');
        }

        actionDropTarget = actionItem;
        if (actionDropTarget)
        {
            actionDropTarget.classList.add('action-drop-hover');
        }
    }
}

async function finalizeInputDrag(event)
{
    try
    {
        if (actionDropTarget && inputDragState && inputDragState.box)
        {
            const actionMapName = actionDropTarget.dataset.actionMap;
            const actionName = actionDropTarget.dataset.actionName;
            const inputString = getButtonIdString(inputDragState.box.buttonData);

            if (actionMapName && actionName && inputString && inputString !== 'Unknown')
            {
                if (window.applyBinding)
                {
                    await window.applyBinding(actionMapName, actionName, inputString, null, null);
                    if (window.showSuccessMessage)
                    {
                        window.showSuccessMessage(`Bound ${actionName} ← ${inputString}`);
                    }
                }
            }
        }
    }
    catch (error)
    {
        console.error('Error binding from input drag:', error);
        if (window.showAlert) await window.showAlert(`Error binding action: ${error}`, 'Error');
    }
    finally
    {
        cleanupInputDrag();
    }
}

function cleanupInputDrag()
{
    document.removeEventListener('mousemove', onInputDragMove, true);
    document.removeEventListener('mouseup', onInputDragEnd, true);

    if (inputDragGhostEl)
    {
        inputDragGhostEl.remove();
        inputDragGhostEl = null;
    }

    if (actionDropTarget)
    {
        actionDropTarget.classList.remove('action-drop-hover');
        actionDropTarget = null;
    }

    document.body.classList.remove('is-input-dragging');
    isInputDragging = false;
    inputDragState = null;
    inputDragStart = null;
}

function formatActivationModeLabel(mode)
{
    if (!mode)
    {
        return '';
    }

    const normalized = mode.replace(/^js\d+_/i, '').replace(/_/g, ' ');
    return normalized
        .split(' ')
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function showBindingInfo(buttonData, bindings)
{
    console.log('showBindingInfo called with:', buttonData.name, 'bindings:', bindings.length);
    selectedButton = { buttonData, bindings };

    // Create or update info panel
    let panel = document.getElementById('binding-info-panel');
    if (!panel)
    {
        console.log('Creating new binding-info-panel');
        panel = document.createElement('div');
        panel.id = 'binding-info-panel';
        panel.className = 'binding-info-panel';
        // Append to the joystick-display which is the actual viewing area
        const joystickDisplay = document.querySelector('.joystick-display');
        if (joystickDisplay)
        {
            joystickDisplay.appendChild(panel);
            console.log('Panel appended to joystick-display');
        }
        else
        {
            document.body.appendChild(panel);
            console.log('Panel appended to body (joystick-display not found)');
        }
    }

    // Build panel content
    let buttonName = simplifyButtonName(buttonData.name);
    if (buttonData.direction)
    {
        buttonName += ` - ${buttonData.direction.charAt(0).toUpperCase() + buttonData.direction.slice(1)}`;
    }

    const buttonIdString = getButtonIdString(buttonData);

    let html = `
        <div class="binding-info-header">
            <h3>${buttonName}</h3>
            <button class="binding-info-close" onclick="hideBindingInfo()">×</button>
        </div>
        <div class="binding-info-details">
            <span class="binding-info-id">Button ID: <code class="button-id-link" onclick="window.searchMainTabForButtonId('${buttonIdString}')" style="cursor: pointer; color: #4a9eff; text-decoration: underline;">${buttonIdString}</code></span>
        </div>
        <div class="binding-info-content">
    `;

    bindings.forEach((binding, index) =>
    {
        // Prepare action label with multi-tap indicator if present
        let actionText = binding.action;
        if (binding.multiTap && binding.multiTap > 1)
        {
            actionText += ` <span class="multi-tap-badge">${binding.multiTap}x tap</span>`;
        }

        const activationModeHtml = binding.activationMode
            ? `<div class="binding-info-activation">Activation Mode: ${formatActivationModeLabel(binding.activationMode)}</div>`
            : '';

        // Show remove button for all bindings (including defaults - clearing a default will set it to blank)
        const removeButtonHtml = `<button class="binding-info-remove-btn" onclick="removeBindingFromVisualView('${escapeForHtml(binding.actionMapName)}', '${escapeForHtml(binding.actionName)}', '${escapeForHtml(binding.inputRaw)}', ${binding.bindingIndex})" title="${binding.isDefault ? 'Clear this default binding' : 'Remove this binding'}">×</button>`;

        html += `
            <div class="binding-info-item ${binding.isDefault ? 'is-default' : ''}">
                <div class="binding-info-item-header">
                    <div class="binding-info-action">${actionText}</div>
                    ${removeButtonHtml}
                </div>
                <div class="binding-info-category">${binding.actionMap}</div>
                ${activationModeHtml}
            </div>
        `;
    });

    html += `</div>`;

    // Add the "Add Action" button footer
    html += `
        <div class="binding-info-footer">
            <button class="binding-info-add-action-btn" onclick="openActionSearchModal('${buttonIdString.replace(/'/g, "\\'")}')">
                <span>+</span> Add Action
            </button>
        </div>
    `;

    panel.innerHTML = html;
    panel.style.display = 'block';
    console.log('Panel display set to block');
}

window.hideBindingInfo = function ()
{
    const panel = document.getElementById('binding-info-panel');
    if (panel)
    {
        panel.style.display = 'none';
    }
    selectedButton = null;
    selectedBox = null;
    isPulsing = false;

    if (highlightTimeout)
    {
        clearTimeout(highlightTimeout);
        highlightTimeout = null;
    }

    resizeViewerCanvas();
};

// Helper function to escape strings for HTML attributes
function escapeForHtml(str)
{
    return str
        .replace(/&/g, '&amp;')
        .replace(/'/g, '&#39;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Remove binding from visual view and refresh the panel
window.removeBindingFromVisualView = async function (actionMapName, actionName, rawInput, bindingIndex)
{
    console.log('Removing binding from visual view:', { actionMapName, actionName, rawInput, bindingIndex });

    // Call the removeBinding function from main.js
    // Note: removeBinding expects (actionMapName, actionName, inputToClear) where inputToClear is the raw input STRING
    if (typeof window.removeBinding === 'function')
    {
        try
        {
            await window.removeBinding(actionMapName, actionName, rawInput);
            console.log('Binding removed successfully');

            // Refresh bindings data without resetting pan/zoom
            await loadCurrentBindings();

            // Just redraw the canvas (preserves pan/zoom)
            resizeViewerCanvas();

            // Refresh the binding info panel if we still have a selected button
            if (selectedButton)
            {
                // Re-search for bindings and update the panel
                const bindings = searchBindings(extractButtonIdentifier(
                    selectedButton.buttonData,
                    selectedButton.buttonData.direction || null
                ));
                showBindingInfo(selectedButton.buttonData, bindings);
            }
        }
        catch (error)
        {
            console.error('Error removing binding:', error);
            alert('Failed to remove binding: ' + error.message);
        }
    }
    else
    {
        console.error('removeBinding function not available');
        alert('Cannot remove binding - function not available');
    }
};

function getButtonIdString(buttonData)
{
    const identifier = extractButtonIdentifier(
        buttonData,
        buttonData.direction || null
    );

    if (identifier.inputString)
    {
        return identifier.inputString;
    }
    else if (identifier.buttonNum !== null)
    {
        return `js${identifier.jsNum}_button${identifier.buttonNum}`;
    }

    return 'Unknown';
}

// LocalStorage helpers for cleaner state management
const ViewerState = {
    save(key, value)
    {
        try
        {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error)
        {
            console.error('Error saving to localStorage:', error);
        }
    },

    load(key, defaultValue = null)
    {
        try
        {
            const value = localStorage.getItem(key);
            return value ? JSON.parse(value) : defaultValue;
        } catch (error)
        {
            console.error('Error loading from localStorage:', error);
            return defaultValue;
        }
    },

    saveTemplate(template, fileName)
    {
        this.save('currentTemplate', template);
        if (fileName)
        {
            localStorage.setItem('templateFileName', fileName);
        }
    },

    saveViewState()
    {
        const currentView = localStorage.getItem('bindingsView') || 'list';
        const { panKey, zoomKey } = getViewerTransformStorageKeys(currentView);

        this.save(panKey, pan);
        localStorage.setItem(zoomKey, zoom.toString());
        localStorage.setItem('viewerCurrentPageIndex', currentPageIndex.toString());
        localStorage.setItem('viewerHideDefaultBindings', hideDefaultBindings.toString());
        localStorage.setItem('viewerModifierFilter', modifierFilter);
    }
};

// Global function to find a button name from an input string
window.findButtonNameForInput = function (inputString)
{
    const template = getCurrentTemplate();
    if (!template || !inputString) return null;

    inputString = inputString.toLowerCase().trim();

    // Helper to check match
    const checkMatch = (button, jsNum, direction = null) =>
    {
        // Get device prefix - try to get from page structure
        let devicePrefix = 'js1';
        if (template.pages && template.pages[currentPageIndex])
        {
            const page = template.pages[currentPageIndex];
            devicePrefix = page.device_prefix || page.devicePrefix || `js${page.joystickNumber || jsNum}`;
        }
        else
        {
            devicePrefix = `js${jsNum}`;
        }

        const jsPrefix = `${devicePrefix}_`;

        // Logic adapted from extractButtonIdentifier but using passed jsNum
        let buttonNum = null;
        let calculatedInputString = null;

        if (direction && button.inputs && button.inputs[direction])
        {
            const dirInput = button.inputs[direction];
            if (typeof dirInput === 'string')
            {
                // For v1.1+ templates, prepend devicePrefix if not already present
                const withPrefix = dirInput.includes('_') ? dirInput : `${devicePrefix}_${dirInput}`;
                calculatedInputString = normalizeInputStringForStick(withPrefix, jsPrefix);
            }
            else if (typeof dirInput === 'object' && dirInput.id !== undefined)
            {
                buttonNum = dirInput.id;
            }
        }
        else
        {
            if (button.buttonId !== undefined && button.buttonId !== null)
            {
                buttonNum = button.buttonId;
            }
            else if (button.inputs && button.inputs.main)
            {
                const main = button.inputs.main;
                if (typeof main === 'object' && main.id !== undefined)
                {
                    if (main.type === 'axis')
                    {
                        const directionSuffix = main.direction ? `_${main.direction}` : '';
                        const axisString = `${devicePrefix}_axis${main.id}${directionSuffix}`;
                        calculatedInputString = normalizeInputStringForStick(axisString, jsPrefix);
                    }
                    else
                    {
                        buttonNum = main.id;
                    }
                }
                else if (typeof main === 'string')
                {
                    // Check if this is an axis name
                    if (main.match(/^(x|y|z|rotx|roty|rotz|slider1|slider2)$/i))
                    {
                        // Axis name - construct directly
                        calculatedInputString = `${jsPrefix}${main.toLowerCase()}`;
                    }
                    else
                    {
                        // Button or other input - prepend devicePrefix if not already present
                        const withPrefix = main.includes('_') ? main : `${devicePrefix}_${main}`;
                        calculatedInputString = normalizeInputStringForStick(withPrefix, jsPrefix);
                    }
                }
            }
            else if (button.inputType === 'axis' && button.inputId !== undefined && button.inputId !== null)
            {
                if (typeof button.inputId === 'string' && button.inputId.match(/^(x|y|z|rotx|roty|rotz|slider1|slider2)$/i))
                {
                    // Axis name format - construct the full input string directly
                    const axisName = button.inputId.toLowerCase();
                    calculatedInputString = `${jsPrefix}${axisName}`;
                }
                else
                {
                    const directionSuffix = button.axisDirection ? `_${button.axisDirection}` : '';
                    const axisString = `${devicePrefix}_axis${button.inputId}${directionSuffix}`;
                    calculatedInputString = normalizeInputStringForStick(axisString, jsPrefix);
                }
            }
            else if (button.inputType === 'button' && button.inputId !== undefined && button.inputId !== null)
            {
                buttonNum = button.inputId;
            }
        }

        if (calculatedInputString === inputString) return true;
        if (buttonNum !== null && inputString === `${jsPrefix}button${buttonNum}`) return true;

        return false;
    };

    // Iterate pages
    let pages = [];
    if (template.pages && template.pages.length > 0)
    {
        pages = template.pages;
    }
    else
    {
        // Legacy support
        if (template.leftStick) pages.push({ ...template.leftStick, joystickNumber: 1 });
        if (template.rightStick) pages.push({ ...template.rightStick, joystickNumber: 2 });
    }

    for (const page of pages)
    {
        const jsNum = page.joystickNumber || 1;
        const buttons = page.buttons || [];

        for (const button of buttons)
        {
            if (button.buttonType === 'hat4way')
            {
                const directions = ['up', 'down', 'left', 'right', 'push'];
                for (const dir of directions)
                {
                    if (checkMatch(button, jsNum, dir))
                    {
                        return `${button.name} [${dir.charAt(0).toUpperCase() + dir.slice(1)}]`;
                    }
                }
            }
            else if (button.buttonType === 'hat2way-vertical')
            {
                const directions = ['up', 'down', 'push'];
                for (const dir of directions)
                {
                    if (checkMatch(button, jsNum, dir))
                    {
                        return `${button.name} [${dir.charAt(0).toUpperCase() + dir.slice(1)}]`;
                    }
                }
            }
            else if (button.buttonType === 'hat2way-horizontal')
            {
                const directions = ['left', 'right', 'push'];
                for (const dir of directions)
                {
                    if (checkMatch(button, jsNum, dir))
                    {
                        return `${button.name} [${dir === 'left' ? '◄' : (dir === 'right' ? '►' : 'Push')}]`;
                    }
                }
            }
            else
            {
                if (checkMatch(button, jsNum))
                {
                    return button.name;
                }
            }
        }
    }

    return null;
};

// ========================================
// Drawing Bounds Tracking (for export)
// ========================================

function resetDrawBounds()
{
    drawBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

// ========================================
// Image Export
// ========================================

async function exportToImage()
{
    if (!window.viewerImage || !getCurrentTemplate())
    {
        await window.showAlert('Please select a template first', 'Select Template');
        return;
    }

    try
    {
        // Show export in progress
        const btn = document.getElementById('export-image-btn');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<span class="control-icon">⏳</span><span>Exporting...</span>';
        btn.disabled = true;

        // First, calculate bounds by doing a dry-run draw to track bounds
        resetDrawBounds();
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');

        // Save old ctx and swap to temp for bounds tracking
        let savedCtx = ctx;
        ctx = tempCtx;
        drawButtons(window.viewerImage, DrawMode.BOUNDS_ONLY);
        ctx = savedCtx;

        // Create export canvas
        const padding = 20;
        const boundsWidth = drawBounds.maxX - drawBounds.minX;
        const boundsHeight = drawBounds.maxY - drawBounds.minY;

        if (!isFinite(boundsWidth) || !isFinite(boundsHeight) || boundsWidth <= 0 || boundsHeight <= 0)
        {
            await window.showAlert('No bindings to export. Please ensure bindings are visible.', 'Nothing to Export');
            btn.innerHTML = originalHTML;
            btn.disabled = false;
            return;
        }

        const exportCanvas = document.createElement('canvas');
        const dpr = window.devicePixelRatio || 1;
        const exportWidth = Math.ceil((boundsWidth + padding * 2) * dpr);
        const exportHeight = Math.ceil((boundsHeight + padding * 2) * dpr);

        exportCanvas.width = exportWidth;
        exportCanvas.height = exportHeight;

        const exportCtx = exportCanvas.getContext('2d');

        // Dark background matching canvas theme
        exportCtx.fillStyle = '#09090b';
        exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

        exportCtx.scale(dpr, dpr);

        // Draw the joystick image centered and properly positioned
        const imgX = padding - drawBounds.minX;
        const imgY = padding - drawBounds.minY;

        const shouldFlip = window.viewerImageFlipped || false;
        if (shouldFlip)
        {
            exportCtx.save();
            exportCtx.translate(imgX + window.viewerImage.width, imgY);
            exportCtx.scale(-1, 1);
            exportCtx.drawImage(window.viewerImage, 0, 0);
            exportCtx.restore();
        }
        else
        {
            exportCtx.drawImage(window.viewerImage, imgX, imgY);
        }

        // Temporarily adjust context for drawing
        exportCtx.save();
        exportCtx.translate(imgX, imgY);

        // Draw all buttons and bindings
        savedCtx = ctx;
        ctx = exportCtx;
        drawButtons(window.viewerImage, DrawMode.EXPORT);
        ctx = savedCtx;

        exportCtx.restore();

        // Convert to PNG
        exportCanvas.toBlob(async (blob) =>
        {
            try
            {
                // Open save dialog
                const fileName = `joystick_bindings_${new Date().getTime()}.png`;

                let resourceDir;
                try
                {
                    resourceDir = await invoke('get_resource_dir');
                }
                catch (e)
                {
                    console.warn('Could not get resource directory:', e);
                }

                const filePath = await save({
                    defaultPath: resourceDir ? `${resourceDir}/${fileName}` : fileName,
                    filters: [
                        {
                            name: 'PNG Image',
                            extensions: ['png']
                        }
                    ]
                });

                if (!filePath)
                {
                    // User cancelled
                    btn.innerHTML = originalHTML;
                    btn.disabled = false;
                    return;
                }

                // Convert blob to array for Tauri
                const arrayBuffer = await blob.arrayBuffer();
                const uint8Array = new Uint8Array(arrayBuffer);

                // Call Tauri command to save file
                await invoke('write_binary_file', {
                    path: filePath,
                    contents: Array.from(uint8Array)
                });

                btn.innerHTML = originalHTML;
                btn.disabled = false;

                // Show success message briefly
                btn.innerHTML = '<span class="control-icon">✓</span><span>Exported!</span>';
                setTimeout(() =>
                {
                    btn.innerHTML = originalHTML;
                }, 2000);
            } catch (error)
            {
                console.error('Error saving file:', error);
                await window.showAlert(`Failed to save image: ${error}`, 'Error');
                btn.innerHTML = originalHTML;
                btn.disabled = false;
            }
        });

    } catch (error)
    {
        console.error('Error exporting image:', error);
        await window.showAlert(`Export failed: ${error}`, 'Error');
        const btn = document.getElementById('export-image-btn');
        btn.innerHTML = '<span class="control-icon">💾</span><span>Export</span>';
        btn.disabled = false;
    }
}

// ========================================
// Configuration Modal
// ========================================

function loadDisplayConfig()
{
    try
    {
        const saved = localStorage.getItem('viewerDisplayConfig');
        if (saved)
        {
            displayConfig = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
        }
        else
        {
            displayConfig = { ...DEFAULT_CONFIG };
        }
    } catch (error)
    {
        console.error('Error loading display config:', error);
        displayConfig = { ...DEFAULT_CONFIG };
    }
}

function saveDisplayConfig()
{
    try
    {
        localStorage.setItem('viewerDisplayConfig', JSON.stringify(displayConfig));
    } catch (error)
    {
        console.error('Error saving display config:', error);
    }
}

function openConfigModal()
{
    const modal = document.getElementById('viewer-config-modal');
    if (!modal) return;

    // Populate sliders with current config values
    const sliders = {
        'config-frame-width': displayConfig.frameWidth,
        'config-frame-height': displayConfig.frameHeight,
        'config-hat-width': displayConfig.hatWidth,
        'config-hat-height': displayConfig.hatHeight,
        'config-num-lines': displayConfig.numLines,
        'config-title-size': displayConfig.titleSize,
        'config-content-size': displayConfig.contentSize
    };

    Object.entries(sliders).forEach(([id, value]) =>
    {
        const slider = document.getElementById(id);
        if (slider)
        {
            slider.value = value;
            updateSliderDisplay(id, value);
        }
    });

    // Set checkbox state
    const greenDefaultsCheckbox = document.getElementById('config-green-defaults');
    if (greenDefaultsCheckbox)
    {
        greenDefaultsCheckbox.checked = displayConfig.greenDefaults || false;
    }

    // Set up slider event listeners
    Object.keys(sliders).forEach(id =>
    {
        const slider = document.getElementById(id);
        if (slider)
        {
            slider.oninput = (e) => updateSliderDisplay(id, e.target.value);
        }
    });

    // Set up button event listeners
    const applyBtn = document.getElementById('config-apply-btn');
    const resetBtn = document.getElementById('config-reset-btn');

    if (applyBtn)
    {
        applyBtn.onclick = applyConfigChanges;
    }

    if (resetBtn)
    {
        resetBtn.onclick = resetConfigToDefaults;
    }

    // Close modal when clicking outside the modal content
    modal.onclick = (e) =>
    {
        if (e.target === modal)
        {
            closeConfigModal();
        }
    };

    modal.style.display = 'flex';
}

function closeConfigModal()
{
    const modal = document.getElementById('viewer-config-modal');
    if (modal)
    {
        modal.style.display = 'none';
    }
}

function updateSliderDisplay(sliderId, value)
{
    const valueId = sliderId + '-value';
    const valueEl = document.getElementById(valueId);
    if (!valueEl) return;

    // Format the value based on the slider type
    if (sliderId.includes('size'))
    {
        valueEl.textContent = value + 'px';
    }
    else
    {
        valueEl.textContent = value;
    }
}

function applyConfigChanges()
{
    // Read all slider values
    displayConfig.frameWidth = parseInt(document.getElementById('config-frame-width').value);
    displayConfig.frameHeight = parseInt(document.getElementById('config-frame-height').value);
    displayConfig.hatWidth = parseInt(document.getElementById('config-hat-width').value);
    displayConfig.hatHeight = parseInt(document.getElementById('config-hat-height').value);
    displayConfig.numLines = parseInt(document.getElementById('config-num-lines').value);
    displayConfig.titleSize = parseInt(document.getElementById('config-title-size').value);
    displayConfig.contentSize = parseInt(document.getElementById('config-content-size').value);

    // Read checkbox value
    const greenDefaultsCheckbox = document.getElementById('config-green-defaults');
    displayConfig.greenDefaults = greenDefaultsCheckbox ? greenDefaultsCheckbox.checked : false;

    // Save to localStorage
    saveDisplayConfig();

    // Close modal
    closeConfigModal();

    // Redraw canvas with new settings
    if (window.viewerImage)
    {
        resizeViewerCanvas();
    }
}

function resetConfigToDefaults()
{
    displayConfig = { ...DEFAULT_CONFIG };

    // Update all sliders
    document.getElementById('config-frame-width').value = DEFAULT_CONFIG.frameWidth;
    document.getElementById('config-frame-height').value = DEFAULT_CONFIG.frameHeight;
    document.getElementById('config-hat-width').value = DEFAULT_CONFIG.hatWidth;
    document.getElementById('config-hat-height').value = DEFAULT_CONFIG.hatHeight;
    document.getElementById('config-num-lines').value = DEFAULT_CONFIG.numLines;
    document.getElementById('config-title-size').value = DEFAULT_CONFIG.titleSize;
    document.getElementById('config-content-size').value = DEFAULT_CONFIG.contentSize;

    // Update checkbox
    const greenDefaultsCheckbox = document.getElementById('config-green-defaults');
    if (greenDefaultsCheckbox)
    {
        greenDefaultsCheckbox.checked = DEFAULT_CONFIG.greenDefaults;
    }

    // Update displays
    updateSliderDisplay('config-frame-width', DEFAULT_CONFIG.frameWidth);
    updateSliderDisplay('config-frame-height', DEFAULT_CONFIG.frameHeight);
    updateSliderDisplay('config-hat-width', DEFAULT_CONFIG.hatWidth);
    updateSliderDisplay('config-hat-height', DEFAULT_CONFIG.hatHeight);
    updateSliderDisplay('config-num-lines', DEFAULT_CONFIG.numLines);
    updateSliderDisplay('config-title-size', DEFAULT_CONFIG.titleSize);
    updateSliderDisplay('config-content-size', DEFAULT_CONFIG.contentSize);

    // Save and redraw
    saveDisplayConfig();
    if (window.viewerImage)
    {
        resizeViewerCanvas();
    }
}

// ============================================================================
// VIEWER FILE INDICATOR MANAGEMENT
// ============================================================================

/**
 * Update the viewer file indicator with the given file name
 * @param {string} fileName - Name of the template file
 */
function updateViewerFileIndicator(fileName)
{
    const indicator = document.getElementById('viewer-file-indicator');
    const filePathEl = document.getElementById('viewer-file-path');
    const fileNameEl = document.getElementById('viewer-file-name');

    if (!indicator || !filePathEl || !fileNameEl) return;

    // For viewer, we only have filename (no full path)
    filePathEl.textContent = '';
    fileNameEl.textContent = fileName;
    fileNameEl.title = fileName;
    indicator.style.display = 'flex';
}

/**
 * Show the no template indicator
 */
function showNoTemplateIndicator()
{
    const indicator = document.getElementById('viewer-file-indicator');
    const filePathEl = document.getElementById('viewer-file-path');
    const fileNameEl = document.getElementById('viewer-file-name');

    if (!indicator || !filePathEl || !fileNameEl) return;

    filePathEl.textContent = '';
    fileNameEl.textContent = 'No Template';
    fileNameEl.title = 'No template loaded';
    indicator.style.display = 'flex';
}

// Export functions for global use
window.updateViewerFileIndicator = updateViewerFileIndicator;
window.showNoTemplateIndicator = showNoTemplateIndicator;

// ============================================================================
// ACTION SEARCH MODAL (Bind actions from Visual View)
// ============================================================================

let currentSearchButtonId = null; // The button ID we're binding to
let currentSearchModifier = ''; // The selected modifier key (e.g., "lalt", "lctrl")

/**
 * Get the full input string with modifier if selected
 * Star Citizen format: js1_lalt+button3 (modifier goes after device prefix, before button)
 */
function getFullInputString()
{
    if (!currentSearchButtonId) return null;

    if (currentSearchModifier)
    {
        // Parse the button ID to insert modifier in correct position
        // Format: js1_button3 -> js1_lalt+button3
        const match = currentSearchButtonId.match(/^(js\d+|gp\d+|kb\d+|mo\d+)_(.+)$/i);
        if (match)
        {
            const devicePrefix = match[1]; // e.g., "js1"
            const buttonPart = match[2];   // e.g., "button3"
            return `${devicePrefix}_${currentSearchModifier}+${buttonPart}`;
        }
        // Fallback if format doesn't match expected pattern
        return `${currentSearchModifier}+${currentSearchButtonId}`;
    }
    return currentSearchButtonId;
}

/**
 * Update the button ID display to show modifier
 */
function updateButtonIdDisplay()
{
    const buttonIdEl = document.getElementById('action-search-button-id');
    if (!buttonIdEl) return;

    const fullInput = getFullInputString();
    buttonIdEl.textContent = fullInput || 'No button selected';
}

/**
 * Set the active modifier and update UI
 */
function setActiveModifier(modifier)
{
    currentSearchModifier = modifier || '';

    // Update button states
    const buttons = document.querySelectorAll('.modifier-btn');
    buttons.forEach(btn =>
    {
        const btnMod = btn.getAttribute('data-modifier') || '';
        if (btnMod === currentSearchModifier)
        {
            btn.classList.add('active');
        }
        else
        {
            btn.classList.remove('active');
        }
    });

    // Update the displayed button ID
    updateButtonIdDisplay();
}

/**
 * Open the action search modal to bind an action to a button
 * @param {string} buttonId - The button ID string (e.g., "js1_button3")
 */
window.openActionSearchModal = function (buttonId)
{
    currentSearchButtonId = buttonId;
    currentSearchModifier = ''; // Reset modifier

    const modal = document.getElementById('action-search-modal');
    const buttonIdEl = document.getElementById('action-search-button-id');
    const searchInput = document.getElementById('action-search-input');
    const resultsEl = document.getElementById('action-search-results');
    const clearBtn = document.getElementById('action-search-clear-btn');

    if (!modal) return;

    // Set the button ID display
    if (buttonIdEl) buttonIdEl.textContent = buttonId;

    // Reset modifier buttons - set "None" as active
    setActiveModifier('');

    // Clear previous search
    if (searchInput) searchInput.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    if (resultsEl) resultsEl.innerHTML = '<div class="action-search-empty">Type to search for actions...</div>';

    // Show modal
    modal.style.display = 'flex';

    // Focus the search input
    setTimeout(() =>
    {
        if (searchInput) searchInput.focus();
    }, 100);
};

/**
 * Close the action search modal
 */
window.closeActionSearchModal = function ()
{
    const modal = document.getElementById('action-search-modal');
    if (modal) modal.style.display = 'none';
    currentSearchButtonId = null;
    currentSearchModifier = '';
};

/**
 * Fuzzy search with support for | (OR) and + (AND) operators
 * @param {string} query - The search query
 * @param {string} text - The text to search in
 * @returns {object} - { matches: boolean, score: number, highlights: Array }
 */
function fuzzySearchWithOperators(query, text)
{
    if (!query || !text) return { matches: false, score: 0, highlights: [] };

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase().trim();

    // Handle OR operator (|)
    if (lowerQuery.includes('|'))
    {
        const orParts = lowerQuery.split('|').map(p => p.trim()).filter(Boolean);
        let bestResult = { matches: false, score: 0, highlights: [] };

        for (const part of orParts)
        {
            const result = fuzzySearchSingle(part, text, lowerText);
            if (result.matches && result.score > bestResult.score)
            {
                bestResult = result;
            }
        }
        return bestResult;
    }

    // Handle AND operator (+)
    if (lowerQuery.includes('+'))
    {
        const andParts = lowerQuery.split('+').map(p => p.trim()).filter(Boolean);
        let allMatch = true;
        let totalScore = 0;
        let allHighlights = [];

        for (const part of andParts)
        {
            const result = fuzzySearchSingle(part, text, lowerText);
            if (!result.matches)
            {
                allMatch = false;
                break;
            }
            totalScore += result.score;
            allHighlights.push(...result.highlights);
        }

        if (allMatch)
        {
            // Merge overlapping highlights
            allHighlights = mergeHighlights(allHighlights);
            return { matches: true, score: totalScore / andParts.length, highlights: allHighlights };
        }
        return { matches: false, score: 0, highlights: [] };
    }

    // Single term fuzzy search
    return fuzzySearchSingle(lowerQuery, text, lowerText);
}

/**
 * Single term fuzzy search
 */
function fuzzySearchSingle(query, originalText, lowerText)
{
    const highlights = [];

    // Exact substring match (highest score)
    const exactIndex = lowerText.indexOf(query);
    if (exactIndex !== -1)
    {
        highlights.push({ start: exactIndex, end: exactIndex + query.length });
        return { matches: true, score: 100 + (query.length / lowerText.length * 50), highlights };
    }

    // Word boundary match
    const words = lowerText.split(/[\s_\-]+/);
    for (let i = 0, pos = 0; i < words.length; i++)
    {
        const word = words[i];
        if (word.startsWith(query))
        {
            const actualPos = lowerText.indexOf(word, pos);
            highlights.push({ start: actualPos, end: actualPos + query.length });
            return { matches: true, score: 80 + (query.length / word.length * 20), highlights };
        }
        pos = lowerText.indexOf(word, pos) + word.length;
    }

    // Fuzzy character matching
    let queryIndex = 0;
    let score = 0;
    let lastMatchIndex = -1;

    for (let i = 0; i < lowerText.length && queryIndex < query.length; i++)
    {
        if (lowerText[i] === query[queryIndex])
        {
            highlights.push({ start: i, end: i + 1 });

            // Consecutive matches get bonus
            if (lastMatchIndex === i - 1) score += 3;
            else score += 1;

            // Word start bonus
            if (i === 0 || /[\s_\-]/.test(lowerText[i - 1])) score += 2;

            lastMatchIndex = i;
            queryIndex++;
        }
    }

    if (queryIndex === query.length)
    {
        // Merge consecutive highlights
        const mergedHighlights = mergeHighlights(highlights);
        return { matches: true, score: score, highlights: mergedHighlights };
    }

    return { matches: false, score: 0, highlights: [] };
}

/**
 * Merge overlapping or consecutive highlight ranges
 */
function mergeHighlights(highlights)
{
    if (highlights.length <= 1) return highlights;

    // Sort by start position
    highlights.sort((a, b) => a.start - b.start);

    const merged = [highlights[0]];
    for (let i = 1; i < highlights.length; i++)
    {
        const last = merged[merged.length - 1];
        const current = highlights[i];

        if (current.start <= last.end)
        {
            last.end = Math.max(last.end, current.end);
        }
        else
        {
            merged.push(current);
        }
    }

    return merged;
}

/**
 * Apply highlights to text for display
 */
function applyHighlights(text, highlights)
{
    if (!highlights || highlights.length === 0) return escapeHtml(text);

    let result = '';
    let lastIndex = 0;

    for (const h of highlights)
    {
        // Add text before highlight
        result += escapeHtml(text.substring(lastIndex, h.start));
        // Add highlighted text
        result += `<span class="highlight">${escapeHtml(text.substring(h.start, h.end))}</span>`;
        lastIndex = h.end;
    }

    // Add remaining text
    result += escapeHtml(text.substring(lastIndex));

    return result;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text)
{
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Search through all actions and return matching results
 */
function searchActions(query)
{
    const keybindings = window.getCurrentKeybindings ? window.getCurrentKeybindings() : null;
    if (!keybindings || !keybindings.action_maps) return [];

    const results = [];

    for (const actionMap of keybindings.action_maps)
    {
        if (!actionMap.actions) continue;

        // Get display name for action map (same pattern as keybindings-page.js)
        const actionMapDisplayName = actionMap.ui_label || actionMap.display_name || actionMap.name;

        for (const action of actionMap.actions)
        {
            // Get display name for action (same pattern as keybindings-page.js)
            const actionDisplayName = action.ui_label || action.display_name || action.name;

            // Search in both display name AND system name for better matching
            const displaySearchResult = fuzzySearchWithOperators(query, actionDisplayName);
            const systemSearchResult = fuzzySearchWithOperators(query, action.name);

            // Use the best match between display name and system name
            const bestMatch = displaySearchResult.score >= systemSearchResult.score
                ? displaySearchResult
                : systemSearchResult;

            if (bestMatch.matches)
            {
                // Get existing bindings for display
                const existingBindings = action.bindings
                    ? action.bindings
                        .filter(b => b.input && b.input !== ' ')
                        .map(b => b.display_name || b.input)
                        .slice(0, 3)
                    : [];

                // Always apply highlights to the display name for consistent UI
                const highlightsForDisplay = displaySearchResult.matches
                    ? displaySearchResult.highlights
                    : []; // No highlights if only system name matched

                results.push({
                    actionMap: actionMap.name,
                    actionMapDisplayName: actionMapDisplayName,
                    actionName: action.name,
                    actionDisplayName: actionDisplayName,
                    score: bestMatch.score,
                    highlights: highlightsForDisplay,
                    existingBindings: existingBindings
                });
            }
        }
    }

    // Sort by score (descending)
    results.sort((a, b) => b.score - a.score);

    // Limit results
    return results.slice(0, 50);
}

/**
 * Render search results
 */
function renderActionSearchResults(results)
{
    const resultsEl = document.getElementById('action-search-results');
    if (!resultsEl) return;

    if (results.length === 0)
    {
        resultsEl.innerHTML = `
            <div class="action-search-no-results">
                <div class="no-results-icon">🔍</div>
                <div>No matching actions found</div>
            </div>
        `;
        return;
    }

    let html = '';

    for (const result of results)
    {
        const highlightedName = applyHighlights(result.actionDisplayName, result.highlights);

        // Show existing bindings if any
        let bindingsHtml = '';
        if (result.existingBindings.length > 0)
        {
            bindingsHtml = `<div class="action-search-result-bindings">
                Current: ${result.existingBindings.map(b => `<code>${escapeHtml(b)}</code>`).join('')}
                ${result.existingBindings.length === 3 ? '...' : ''}
            </div>`;
        }

        html += `
            <div class="action-search-result-item">
                <div class="action-search-result-info">
                    <div class="action-search-result-name">${highlightedName}</div>
                    <div class="action-search-result-category">${escapeHtml(result.actionMapDisplayName)}</div>
                    ${bindingsHtml}
                </div>
                <button class="action-search-bind-btn" 
                        onclick="bindActionFromSearch('${escapeHtml(result.actionMap)}', '${escapeHtml(result.actionName)}')">
                    Bind
                </button>
            </div>
        `;
    }

    resultsEl.innerHTML = html;
}

/**
 * Handle binding an action from the search modal
 */
window.bindActionFromSearch = async function (actionMapName, actionName)
{
    if (!currentSearchButtonId)
    {
        console.error('No button ID set for binding');
        return;
    }

    // Get the full input string with modifier
    const fullInputString = getFullInputString();

    console.log(`Binding ${actionMapName}/${actionName} to ${fullInputString}`);

    try
    {
        // Use the applyBinding function from keybindings-page.js
        if (window.applyBinding)
        {
            await window.applyBinding(actionMapName, actionName, fullInputString, null, null);

            // Close the modal
            closeActionSearchModal();

            // Refresh the visual view to show the new binding
            if (window.refreshVisualView)
            {
                await window.refreshVisualView();
            }

            // Refresh the binding info panel if we still have a selected button
            if (selectedButton)
            {
                // Re-search for bindings and update the panel
                const bindings = searchBindings(extractButtonIdentifier(
                    selectedButton.buttonData,
                    selectedButton.buttonData.direction || null
                ));
                showBindingInfo(selectedButton.buttonData, bindings);
            }

            // Show success message
            if (window.showSuccessMessage)
            {
                window.showSuccessMessage(`Bound "${actionName}" to ${fullInputString}`);
            }
        }
        else
        {
            console.error('applyBinding function not available');
            alert('Error: Binding system not loaded. Please load keybindings first.');
        }
    }
    catch (error)
    {
        console.error('Error binding action:', error);
        alert(`Error binding action: ${error.message || error}`);
    }
};

// Initialize action search modal event listeners
function initActionSearchModal()
{
    const searchInput = document.getElementById('action-search-input');
    const clearBtn = document.getElementById('action-search-clear-btn');
    const cancelBtn = document.getElementById('action-search-cancel-btn');
    const modal = document.getElementById('action-search-modal');

    if (searchInput)
    {
        // Debounce search
        let searchTimeout = null;

        searchInput.addEventListener('input', () =>
        {
            const query = searchInput.value.trim();

            // Show/hide clear button
            if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';

            // Debounce search
            if (searchTimeout) clearTimeout(searchTimeout);

            if (!query)
            {
                const resultsEl = document.getElementById('action-search-results');
                if (resultsEl) resultsEl.innerHTML = '<div class="action-search-empty">Type to search for actions...</div>';
                return;
            }

            searchTimeout = setTimeout(() =>
            {
                const results = searchActions(query);
                renderActionSearchResults(results);
            }, 150);
        });

        // Handle Enter key to bind first result
        searchInput.addEventListener('keydown', (e) =>
        {
            if (e.key === 'Escape')
            {
                closeActionSearchModal();
            }
        });
    }

    if (clearBtn)
    {
        clearBtn.addEventListener('click', () =>
        {
            if (searchInput) searchInput.value = '';
            clearBtn.style.display = 'none';
            const resultsEl = document.getElementById('action-search-results');
            if (resultsEl) resultsEl.innerHTML = '<div class="action-search-empty">Type to search for actions...</div>';
            if (searchInput) searchInput.focus();
        });
    }

    if (cancelBtn)
    {
        cancelBtn.addEventListener('click', closeActionSearchModal);
    }

    // Close modal when clicking outside
    if (modal)
    {
        modal.addEventListener('click', (e) =>
        {
            if (e.target === modal)
            {
                closeActionSearchModal();
            }
        });
    }

    // Initialize modifier button event listeners
    const modifierBtns = document.querySelectorAll('.modifier-btn');
    modifierBtns.forEach(btn =>
    {
        btn.addEventListener('click', () =>
        {
            const modifier = btn.getAttribute('data-modifier') || '';
            setActiveModifier(modifier);
        });
    });
}

// Initialize on DOM ready
if (document.readyState === 'loading')
{
    document.addEventListener('DOMContentLoaded', initActionSearchModal);
}
else
{
    initActionSearchModal();
}

// ============================================================================
// KEYBOARD VIEW FUNCTIONALITY
// ============================================================================

let keyboardViewVisible = false;
let keyboardContainer = null;
let selectedKeyElement = null;

// Keyboard view pan/zoom state
let keyboardZoom = 1.0;
let keyboardPan = { x: 0, y: 0 };
let keyboardIsPanning = false;
let keyboardLastPanPos = { x: 0, y: 0 };

// Star Citizen key code mapping (keyboard code -> SC format)
const SC_KEY_MAP = {
    // Function keys
    'Escape': 'escape', 'F1': 'f1', 'F2': 'f2', 'F3': 'f3', 'F4': 'f4',
    'F5': 'f5', 'F6': 'f6', 'F7': 'f7', 'F8': 'f8', 'F9': 'f9',
    'F10': 'f10', 'F11': 'f11', 'F12': 'f12',

    // Number row
    'Backquote': 'grave', 'Digit1': '1', 'Digit2': '2', 'Digit3': '3', 'Digit4': '4',
    'Digit5': '5', 'Digit6': '6', 'Digit7': '7', 'Digit8': '8', 'Digit9': '9',
    'Digit0': '0', 'Minus': 'minus', 'Equal': 'equals', 'Backspace': 'backspace',

    // Top row
    'Tab': 'tab', 'KeyQ': 'q', 'KeyW': 'w', 'KeyE': 'e', 'KeyR': 'r',
    'KeyT': 't', 'KeyY': 'y', 'KeyU': 'u', 'KeyI': 'i', 'KeyO': 'o',
    'KeyP': 'p', 'BracketLeft': 'lbracket', 'BracketRight': 'rbracket', 'Backslash': 'backslash',

    // Home row
    'CapsLock': 'capslock', 'KeyA': 'a', 'KeyS': 's', 'KeyD': 'd', 'KeyF': 'f',
    'KeyG': 'g', 'KeyH': 'h', 'KeyJ': 'j', 'KeyK': 'k', 'KeyL': 'l',
    'Semicolon': 'semicolon', 'Quote': 'apostrophe', 'Enter': 'enter',

    // Bottom row
    'ShiftLeft': 'lshift', 'KeyZ': 'z', 'KeyX': 'x', 'KeyC': 'c', 'KeyV': 'v',
    'KeyB': 'b', 'KeyN': 'n', 'KeyM': 'm', 'Comma': 'comma', 'Period': 'period',
    'Slash': 'slash', 'ShiftRight': 'rshift',

    // Bottom control row
    'ControlLeft': 'lctrl', 'MetaLeft': 'lwin', 'AltLeft': 'lalt', 'Space': 'space',
    'AltRight': 'ralt', 'MetaRight': 'rwin', 'ContextMenu': 'apps', 'ControlRight': 'rctrl',

    // Navigation cluster
    'PrintScreen': 'print', 'ScrollLock': 'scrolllock', 'Pause': 'pause',
    'Insert': 'insert', 'Home': 'home', 'PageUp': 'pgup',
    'Delete': 'delete', 'End': 'end', 'PageDown': 'pgdn',

    // Arrow keys
    'ArrowUp': 'up', 'ArrowLeft': 'left', 'ArrowDown': 'down', 'ArrowRight': 'right',

    // Numpad
    'NumLock': 'numlock', 'NumpadDivide': 'np_divide', 'NumpadMultiply': 'np_multiply', 'NumpadSubtract': 'np_subtract',
    'Numpad7': 'np_7', 'Numpad8': 'np_8', 'Numpad9': 'np_9', 'NumpadAdd': 'np_add',
    'Numpad4': 'np_4', 'Numpad5': 'np_5', 'Numpad6': 'np_6',
    'Numpad1': 'np_1', 'Numpad2': 'np_2', 'Numpad3': 'np_3', 'NumpadEnter': 'np_enter',
    'Numpad0': 'np_0', 'NumpadDecimal': 'np_period'
};

// Keyboard layout definition
const KEYBOARD_LAYOUT = {
    // Function row
    functionRow: [
        { code: 'Escape', label: 'Esc', width: '1u' },
        { spacer: true, width: '1u' },
        { code: 'F1', label: 'F1', width: '1u' },
        { code: 'F2', label: 'F2', width: '1u' },
        { code: 'F3', label: 'F3', width: '1u' },
        { code: 'F4', label: 'F4', width: '1u' },
        { spacer: true, width: '0.5u' },
        { code: 'F5', label: 'F5', width: '1u' },
        { code: 'F6', label: 'F6', width: '1u' },
        { code: 'F7', label: 'F7', width: '1u' },
        { code: 'F8', label: 'F8', width: '1u' },
        { spacer: true, width: '0.5u' },
        { code: 'F9', label: 'F9', width: '1u' },
        { code: 'F10', label: 'F10', width: '1u' },
        { code: 'F11', label: 'F11', width: '1u' },
        { code: 'F12', label: 'F12', width: '1u' }
    ],

    // Navigation cluster function row
    navFunctionRow: [
        { code: 'PrintScreen', label: 'PrtSc', width: '1u' },
        { code: 'ScrollLock', label: 'ScrLk', width: '1u' },
        { code: 'Pause', label: 'Pause', width: '1u' }
    ],

    // Number row
    numberRow: [
        { code: 'Backquote', label: '`', width: '1u' },
        { code: 'Digit1', label: '1', width: '1u' },
        { code: 'Digit2', label: '2', width: '1u' },
        { code: 'Digit3', label: '3', width: '1u' },
        { code: 'Digit4', label: '4', width: '1u' },
        { code: 'Digit5', label: '5', width: '1u' },
        { code: 'Digit6', label: '6', width: '1u' },
        { code: 'Digit7', label: '7', width: '1u' },
        { code: 'Digit8', label: '8', width: '1u' },
        { code: 'Digit9', label: '9', width: '1u' },
        { code: 'Digit0', label: '0', width: '1u' },
        { code: 'Minus', label: '-', width: '1u' },
        { code: 'Equal', label: '=', width: '1u' },
        { code: 'Backspace', label: 'Backspace', width: '2u' }
    ],

    // Navigation cluster row 1
    navRow1: [
        { code: 'Insert', label: 'Ins', width: '1u' },
        { code: 'Home', label: 'Home', width: '1u' },
        { code: 'PageUp', label: 'PgUp', width: '1u' }
    ],

    // Numpad row 1
    numpadRow1: [
        { code: 'NumLock', label: 'Num', width: '1u' },
        { code: 'NumpadDivide', label: '/', width: '1u' },
        { code: 'NumpadMultiply', label: '*', width: '1u' },
        { code: 'NumpadSubtract', label: '-', width: '1u' }
    ],

    // QWERTY row
    qwertyRow: [
        { code: 'Tab', label: 'Tab', width: '1-5u' },
        { code: 'KeyQ', label: 'Q', width: '1u' },
        { code: 'KeyW', label: 'W', width: '1u' },
        { code: 'KeyE', label: 'E', width: '1u' },
        { code: 'KeyR', label: 'R', width: '1u' },
        { code: 'KeyT', label: 'T', width: '1u' },
        { code: 'KeyY', label: 'Y', width: '1u' },
        { code: 'KeyU', label: 'U', width: '1u' },
        { code: 'KeyI', label: 'I', width: '1u' },
        { code: 'KeyO', label: 'O', width: '1u' },
        { code: 'KeyP', label: 'P', width: '1u' },
        { code: 'BracketLeft', label: '[', width: '1u' },
        { code: 'BracketRight', label: ']', width: '1u' },
        { code: 'Backslash', label: '\\', width: '1-5u' }
    ],

    // Navigation cluster row 2
    navRow2: [
        { code: 'Delete', label: 'Del', width: '1u' },
        { code: 'End', label: 'End', width: '1u' },
        { code: 'PageDown', label: 'PgDn', width: '1u' }
    ],

    // Numpad row 2
    numpadRow2: [
        { code: 'Numpad7', label: '7', width: '1u' },
        { code: 'Numpad8', label: '8', width: '1u' },
        { code: 'Numpad9', label: '9', width: '1u' },
        { code: 'NumpadAdd', label: '+', width: '1u', height: '2u' }
    ],

    // Home row (ASDF)
    homeRow: [
        { code: 'CapsLock', label: 'Caps', width: '1-75u' },
        { code: 'KeyA', label: 'A', width: '1u' },
        { code: 'KeyS', label: 'S', width: '1u' },
        { code: 'KeyD', label: 'D', width: '1u' },
        { code: 'KeyF', label: 'F', width: '1u' },
        { code: 'KeyG', label: 'G', width: '1u' },
        { code: 'KeyH', label: 'H', width: '1u' },
        { code: 'KeyJ', label: 'J', width: '1u' },
        { code: 'KeyK', label: 'K', width: '1u' },
        { code: 'KeyL', label: 'L', width: '1u' },
        { code: 'Semicolon', label: ';', width: '1u' },
        { code: 'Quote', label: "'", width: '1u' },
        { code: 'Enter', label: 'Enter', width: '2-25u' }
    ],

    // Numpad row 3
    numpadRow3: [
        { code: 'Numpad4', label: '4', width: '1u' },
        { code: 'Numpad5', label: '5', width: '1u' },
        { code: 'Numpad6', label: '6', width: '1u' }
    ],

    // Bottom alpha row (ZXCV)
    bottomRow: [
        { code: 'ShiftLeft', label: 'Shift', width: '2-25u', modifier: true },
        { code: 'KeyZ', label: 'Z', width: '1u' },
        { code: 'KeyX', label: 'X', width: '1u' },
        { code: 'KeyC', label: 'C', width: '1u' },
        { code: 'KeyV', label: 'V', width: '1u' },
        { code: 'KeyB', label: 'B', width: '1u' },
        { code: 'KeyN', label: 'N', width: '1u' },
        { code: 'KeyM', label: 'M', width: '1u' },
        { code: 'Comma', label: ',', width: '1u' },
        { code: 'Period', label: '.', width: '1u' },
        { code: 'Slash', label: '/', width: '1u' },
        { code: 'ShiftRight', label: 'Shift', width: '2-75u', modifier: true }
    ],

    // Arrow keys (up)
    arrowUp: [
        { code: 'ArrowUp', label: '↑', width: '1u' }
    ],

    // Numpad row 4
    numpadRow4: [
        { code: 'Numpad1', label: '1', width: '1u' },
        { code: 'Numpad2', label: '2', width: '1u' },
        { code: 'Numpad3', label: '3', width: '1u' },
        { code: 'NumpadEnter', label: 'Enter', width: '1u', height: '2u' }
    ],

    // Control row
    controlRow: [
        { code: 'ControlLeft', label: 'Ctrl', width: '1-5u', modifier: true },
        { code: 'MetaLeft', label: 'Win', width: '1u', modifier: true },
        { code: 'AltLeft', label: 'Alt', width: '1-5u', modifier: true },
        { code: 'Space', label: 'Space', width: '6-25u' },
        { code: 'AltRight', label: 'Alt', width: '1-5u', modifier: true },
        { code: 'MetaRight', label: 'Win', width: '1u', modifier: true },
        { code: 'ContextMenu', label: 'Menu', width: '1u' },
        { code: 'ControlRight', label: 'Ctrl', width: '1-5u', modifier: true }
    ],

    // Arrow keys (bottom)
    arrowBottom: [
        { code: 'ArrowLeft', label: '←', width: '1u' },
        { code: 'ArrowDown', label: '↓', width: '1u' },
        { code: 'ArrowRight', label: '→', width: '1u' }
    ],

    // Numpad row 5
    numpadRow5: [
        { code: 'Numpad0', label: '0', width: '2u' },
        { code: 'NumpadDecimal', label: '.', width: '1u' }
    ]
};

/**
 * Search for keyboard bindings for a specific key
 * @param {string} scKey - Star Citizen key code (e.g., 'w', 'space', 'lalt')
 * @returns {Array} - Array of binding objects
 */
function searchKeyboardBindings(scKey)
{
    if (!currentBindings || !scKey) return [];

    // Match both kb1_key and kb_key formats (defaults use kb_, custom use kb1_)
    const inputString1 = `kb1_${scKey}`;
    const inputString2 = `kb_${scKey}`;
    const allBindings = [];

    for (const actionMap of currentBindings.action_maps)
    {
        for (const action of actionMap.actions)
        {
            if (!action.bindings || action.bindings.length === 0) continue;

            for (let bindingIndex = 0; bindingIndex < action.bindings.length; bindingIndex++)
            {
                const binding = action.bindings[bindingIndex];
                if (binding.input_type !== 'Keyboard') continue;

                let input = binding.input.toLowerCase();
                let modifiers = [];
                let inputWithoutModifier = input;

                // Handle modifier format: kb1_lalt+w or kb_lalt+w
                const modifierMatch = input.match(/^(kb\d*?)_([a-z]+)\+(.+)$/i);
                if (modifierMatch)
                {
                    modifiers = [modifierMatch[2]];
                    inputWithoutModifier = `${modifierMatch[1]}_${modifierMatch[3]}`;
                }

                // Check if this binding matches our key (both kb1_ and kb_ formats)
                if (inputWithoutModifier === inputString1 || inputWithoutModifier === inputString2)
                {
                    let actionLabel = action.ui_label || action.display_name || action.name;

                    if (modifiers.length > 0)
                    {
                        actionLabel = modifiers.join('+') + ' + ' + actionLabel;
                    }

                    if (action.on_hold)
                    {
                        actionLabel += ' (Hold)';
                    }

                    const mapLabel = actionMap.ui_label || actionMap.display_name || actionMap.name;

                    allBindings.push({
                        action: actionLabel,
                        actionName: action.name,
                        actionMapName: actionMap.name,
                        input: binding.display_name,
                        inputRaw: binding.input,
                        bindingIndex: bindingIndex,
                        actionMap: mapLabel,
                        isDefault: binding.is_default,
                        modifiers: modifiers,
                        multiTap: binding.multi_tap,
                        activationMode: binding.activation_mode || null
                    });
                }
            }
        }
    }

    // Sort: custom bindings first, then defaults
    allBindings.sort((a, b) =>
    {
        if (a.isDefault === b.isDefault) return 0;
        return a.isDefault ? 1 : -1;
    });

    // Apply filters
    let filteredBindings = allBindings;

    if (hideDefaultBindings)
    {
        filteredBindings = filteredBindings.filter(b => !b.isDefault);
    }

    if (modifierFilter !== 'all')
    {
        filteredBindings = filteredBindings.filter(b =>
            b.modifiers && b.modifiers.includes(modifierFilter)
        );
    }

    return filteredBindings;
}

/**
 * Create a keyboard key element
 */
function createKeyElement(keyDef)
{
    if (keyDef.spacer)
    {
        const spacer = document.createElement('div');
        spacer.className = 'keyboard-section-gap';
        spacer.style.width = keyDef.width === '0.5u' ? '10px' : '20px';
        return spacer;
    }

    const key = document.createElement('div');
    key.className = 'keyboard-key';
    key.dataset.code = keyDef.code;

    // Apply width class
    if (keyDef.width)
    {
        key.classList.add(`key-${keyDef.width}`);
    }

    // Apply height for special keys
    if (keyDef.height === '2u')
    {
        if (keyDef.code === 'NumpadEnter') key.classList.add('key-numpad-enter');
        else if (keyDef.code === 'NumpadAdd') key.classList.add('key-numpad-plus');
    }

    // Mark modifier keys
    if (keyDef.modifier)
    {
        key.classList.add('modifier-key');
    }

    // Key label
    const label = document.createElement('div');
    label.className = 'key-label';
    label.textContent = keyDef.label;
    key.appendChild(label);

    // Bindings container
    const bindingsContainer = document.createElement('div');
    bindingsContainer.className = 'key-bindings';
    key.appendChild(bindingsContainer);

    // Click handler
    key.addEventListener('click', () => onKeyboardKeyClick(key, keyDef));

    // Hover handlers for tooltip
    key.addEventListener('mouseenter', (e) => showKeyTooltip(e, keyDef));
    key.addEventListener('mouseleave', hideKeyTooltip);

    return key;
}

/**
 * Populate bindings for a key element
 */
function updateKeyBindings(keyElement, keyDef)
{
    const scKey = SC_KEY_MAP[keyDef.code];
    if (!scKey) return;

    const bindings = searchKeyboardBindings(scKey);
    const bindingsContainer = keyElement.querySelector('.key-bindings');
    bindingsContainer.innerHTML = '';

    // Update key state
    keyElement.classList.remove('has-binding', 'has-custom-binding');

    if (bindings.length > 0)
    {
        keyElement.classList.add('has-binding');

        // Check if any are custom (non-default)
        if (bindings.some(b => !b.isDefault))
        {
            keyElement.classList.add('has-custom-binding');
        }

        // Show up to 5 bindings on the key (keys are 70px tall now)
        const maxVisible = 5;
        const visibleBindings = bindings.slice(0, maxVisible);

        visibleBindings.forEach(binding =>
        {
            const item = document.createElement('div');
            item.className = 'key-binding-item';
            if (binding.isDefault) item.classList.add('is-default');
            item.textContent = binding.action;
            bindingsContainer.appendChild(item);
        });

        if (bindings.length > maxVisible)
        {
            const more = document.createElement('div');
            more.className = 'key-binding-more';
            more.textContent = `+${bindings.length - maxVisible} more`;
            bindingsContainer.appendChild(more);
        }
    }
}

/**
 * Handle keyboard key click
 */
function onKeyboardKeyClick(keyElement, keyDef)
{
    const scKey = SC_KEY_MAP[keyDef.code];
    if (!scKey) return;

    // Update selection
    if (selectedKeyElement)
    {
        selectedKeyElement.classList.remove('selected');
    }
    selectedKeyElement = keyElement;
    keyElement.classList.add('selected');

    // Show binding info panel
    const buttonId = `kb1_${scKey}`;
    const bindings = searchKeyboardBindings(scKey);

    // Create a pseudo button data object for the info panel
    const buttonData = {
        name: keyDef.label,
        input: buttonId
    };

    showBindingInfo(buttonData, bindings);
}

/**
 * Show tooltip with full binding info
 */
function showKeyTooltip(event, keyDef)
{
    const scKey = SC_KEY_MAP[keyDef.code];
    if (!scKey) return;

    const bindings = searchKeyboardBindings(scKey);
    if (bindings.length === 0) return;

    // Remove existing tooltip
    hideKeyTooltip();

    const tooltip = document.createElement('div');
    tooltip.className = 'keyboard-key-tooltip';
    tooltip.id = 'keyboard-key-tooltip';

    let html = `<div class="tooltip-title">${keyDef.label} (kb1_${scKey})</div>`;

    bindings.forEach(binding =>
    {
        html += `<div class="tooltip-binding ${binding.isDefault ? 'is-default' : ''}">${binding.action}</div>`;
        html += `<div class="tooltip-category">${binding.actionMap}</div>`;
    });

    tooltip.innerHTML = html;
    document.body.appendChild(tooltip);

    // Position tooltip
    const rect = event.target.getBoundingClientRect();
    tooltip.style.left = `${rect.right + 10}px`;
    tooltip.style.top = `${rect.top}px`;

    // Keep tooltip in viewport
    const tooltipRect = tooltip.getBoundingClientRect();
    if (tooltipRect.right > window.innerWidth)
    {
        tooltip.style.left = `${rect.left - tooltipRect.width - 10}px`;
    }
    if (tooltipRect.bottom > window.innerHeight)
    {
        tooltip.style.top = `${window.innerHeight - tooltipRect.height - 10}px`;
    }
}

/**
 * Hide tooltip
 */
function hideKeyTooltip()
{
    const tooltip = document.getElementById('keyboard-key-tooltip');
    if (tooltip) tooltip.remove();
}

/**
 * Build the keyboard layout
 */
function buildKeyboardLayout()
{
    if (keyboardContainer)
    {
        // Just update bindings
        refreshKeyboardBindings();
        return;
    }

    // Create container
    keyboardContainer = document.createElement('div');
    keyboardContainer.className = 'keyboard-view-container';
    keyboardContainer.id = 'keyboard-view-container';

    // Create inner wrapper for pan/zoom transforms
    const layoutWrapper = document.createElement('div');
    layoutWrapper.className = 'keyboard-layout-wrapper';
    layoutWrapper.id = 'keyboard-layout-wrapper';

    const layout = document.createElement('div');
    layout.className = 'keyboard-layout';

    // Build the layout
    // Function row with nav cluster
    const functionSection = document.createElement('div');
    functionSection.className = 'keyboard-main-section';

    const funcRow = createKeyboardRow(KEYBOARD_LAYOUT.functionRow, 'function-row');
    functionSection.appendChild(funcRow);

    // Gap between main and nav
    const gap1 = document.createElement('div');
    gap1.className = 'keyboard-section-gap';
    functionSection.appendChild(gap1);

    const navFuncRow = createKeyboardRow(KEYBOARD_LAYOUT.navFunctionRow);
    functionSection.appendChild(navFuncRow);

    layout.appendChild(functionSection);

    // Row spacer
    const spacer1 = document.createElement('div');
    spacer1.className = 'keyboard-row-spacer';
    layout.appendChild(spacer1);

    // Number row with nav cluster row 1 and numpad row 1
    const numberSection = document.createElement('div');
    numberSection.className = 'keyboard-main-section';
    numberSection.appendChild(createKeyboardRow(KEYBOARD_LAYOUT.numberRow));
    numberSection.appendChild(createGap());
    numberSection.appendChild(createKeyboardRow(KEYBOARD_LAYOUT.navRow1));
    numberSection.appendChild(createGap());
    numberSection.appendChild(createKeyboardRow(KEYBOARD_LAYOUT.numpadRow1));
    layout.appendChild(numberSection);

    // QWERTY row with nav cluster row 2 and numpad row 2
    const qwertySection = document.createElement('div');
    qwertySection.className = 'keyboard-main-section';
    qwertySection.appendChild(createKeyboardRow(KEYBOARD_LAYOUT.qwertyRow));
    qwertySection.appendChild(createGap());
    qwertySection.appendChild(createKeyboardRow(KEYBOARD_LAYOUT.navRow2));
    qwertySection.appendChild(createGap());
    qwertySection.appendChild(createKeyboardRow(KEYBOARD_LAYOUT.numpadRow2));
    layout.appendChild(qwertySection);

    // Home row with numpad row 3 (no nav cluster)
    const homeSection = document.createElement('div');
    homeSection.className = 'keyboard-main-section';
    homeSection.appendChild(createKeyboardRow(KEYBOARD_LAYOUT.homeRow));
    homeSection.appendChild(createGap());
    // Empty space where nav cluster would be
    const emptyNav1 = document.createElement('div');
    emptyNav1.style.width = '162px'; // 3 keys * 54px
    homeSection.appendChild(emptyNav1);
    homeSection.appendChild(createGap());
    homeSection.appendChild(createKeyboardRow(KEYBOARD_LAYOUT.numpadRow3));
    layout.appendChild(homeSection);

    // Bottom row with arrow up and numpad row 4
    const bottomSection = document.createElement('div');
    bottomSection.className = 'keyboard-main-section';
    bottomSection.appendChild(createKeyboardRow(KEYBOARD_LAYOUT.bottomRow));
    bottomSection.appendChild(createGap());
    // Arrow up centered
    const arrowUpContainer = document.createElement('div');
    arrowUpContainer.style.display = 'flex';
    arrowUpContainer.style.justifyContent = 'center';
    arrowUpContainer.style.width = '162px';
    arrowUpContainer.appendChild(createKeyboardRow(KEYBOARD_LAYOUT.arrowUp));
    bottomSection.appendChild(arrowUpContainer);
    bottomSection.appendChild(createGap());
    bottomSection.appendChild(createKeyboardRow(KEYBOARD_LAYOUT.numpadRow4));
    layout.appendChild(bottomSection);

    // Control row with arrow bottom and numpad row 5
    const controlSection = document.createElement('div');
    controlSection.className = 'keyboard-main-section';
    controlSection.appendChild(createKeyboardRow(KEYBOARD_LAYOUT.controlRow));
    controlSection.appendChild(createGap());
    controlSection.appendChild(createKeyboardRow(KEYBOARD_LAYOUT.arrowBottom));
    controlSection.appendChild(createGap());
    controlSection.appendChild(createKeyboardRow(KEYBOARD_LAYOUT.numpadRow5));
    layout.appendChild(controlSection);

    layoutWrapper.appendChild(layout);
    keyboardContainer.appendChild(layoutWrapper);

    // Add pan/zoom event listeners
    keyboardContainer.addEventListener('wheel', onKeyboardWheel, { passive: false });
    keyboardContainer.addEventListener('mousedown', onKeyboardMouseDown);
    keyboardContainer.addEventListener('mousemove', onKeyboardMouseMove);
    keyboardContainer.addEventListener('mouseup', onKeyboardMouseUp);
    keyboardContainer.addEventListener('mouseleave', onKeyboardMouseUp);
    keyboardContainer.addEventListener('contextmenu', (e) => e.preventDefault());
    keyboardContainer.addEventListener('dblclick', onKeyboardDblClick);

    // Append to joystick display area
    const joystickDisplay = document.querySelector('.joystick-display');
    if (joystickDisplay)
    {
        joystickDisplay.appendChild(keyboardContainer);
    }

    // Apply initial transform
    updateKeyboardTransform();
}

/**
 * Create a keyboard row
 */
function createKeyboardRow(keys, extraClass = '')
{
    const row = document.createElement('div');
    row.className = 'keyboard-row';
    if (extraClass) row.classList.add(extraClass);

    keys.forEach(keyDef =>
    {
        row.appendChild(createKeyElement(keyDef));
    });

    return row;
}

/**
 * Create a gap element
 */
function createGap()
{
    const gap = document.createElement('div');
    gap.className = 'keyboard-section-gap';
    return gap;
}

/**
 * Refresh all keyboard bindings
 */
function refreshKeyboardBindings()
{
    if (!keyboardContainer) return;

    const allKeys = keyboardContainer.querySelectorAll('.keyboard-key');
    allKeys.forEach(keyElement =>
    {
        const code = keyElement.dataset.code;
        if (!code) return;

        // Find the key definition
        const keyDef = findKeyDef(code);
        if (keyDef)
        {
            updateKeyBindings(keyElement, keyDef);
        }
    });
}

/**
 * Find key definition by code
 */
function findKeyDef(code)
{
    for (const rowName of Object.keys(KEYBOARD_LAYOUT))
    {
        const row = KEYBOARD_LAYOUT[rowName];
        const found = row.find(k => k.code === code);
        if (found) return found;
    }
    return null;
}

/**
 * Toggle keyboard view visibility
 */
function toggleKeyboardView()
{
    keyboardViewVisible = !keyboardViewVisible;

    const toggleBtn = document.getElementById('keyboard-view-toggle');
    const welcomeScreen = document.getElementById('welcome-screen-visual');
    const canvasContainer = document.getElementById('viewer-canvas-container');
    const toolbar = document.getElementById('modifier-toolbar');

    if (keyboardViewVisible)
    {
        // Build/update keyboard
        buildKeyboardLayout();
        refreshKeyboardBindings();
        keyboardContainer.classList.add('visible');

        // Hide canvas container and welcome screen
        if (canvasContainer) canvasContainer.style.display = 'none';
        if (welcomeScreen) welcomeScreen.style.display = 'none';

        // Update button state
        if (toggleBtn) toggleBtn.classList.add('active');

        // Show modifier toolbar
        if (toolbar) toolbar.style.display = 'flex';
    }
    else
    {
        // Hide keyboard
        if (keyboardContainer) keyboardContainer.classList.remove('visible');

        // Restore previous view state - show canvas if template is loaded, otherwise welcome screen
        const template = getCurrentTemplate();
        if (template && window.viewerImage)
        {
            if (canvasContainer) canvasContainer.style.display = 'flex';
            if (welcomeScreen) welcomeScreen.style.display = 'none';
        }
        else
        {
            if (canvasContainer) canvasContainer.style.display = 'none';
            if (welcomeScreen) welcomeScreen.style.display = 'flex';
            // Hide modifier toolbar if no template
            if (toolbar) toolbar.style.display = 'none';
        }

        // Update button state
        if (toggleBtn) toggleBtn.classList.remove('active');

        // Hide binding info panel
        hideBindingInfo();
        hideKeyTooltip();

        // Clear selection
        if (selectedKeyElement)
        {
            selectedKeyElement.classList.remove('selected');
            selectedKeyElement = null;
        }
    }

    // Save state
    localStorage.setItem('keyboardViewVisible', keyboardViewVisible.toString());
}

/**
 * Initialize keyboard view button listener
 */
function initKeyboardView()
{
    const toggleBtn = document.getElementById('keyboard-view-toggle');
    if (toggleBtn)
    {
        toggleBtn.addEventListener('click', toggleKeyboardView);
    }

    // Don't auto-restore keyboard view state on page load
    // It can cause layout issues if bindings aren't loaded yet
    // User can click the button to show keyboard when ready
}

/**
 * Update keyboard transform for pan/zoom
 */
function updateKeyboardTransform()
{
    const wrapper = document.getElementById('keyboard-layout-wrapper');
    if (wrapper)
    {
        wrapper.style.transform = `translate(${keyboardPan.x}px, ${keyboardPan.y}px) scale(${keyboardZoom})`;
    }
}

/**
 * Handle mouse wheel for keyboard zoom
 */
function onKeyboardWheel(e)
{
    e.preventDefault();

    const zoomSpeed = 0.001;
    const minZoom = 0.3;
    const maxZoom = 3.0;

    // Calculate new zoom
    const delta = -e.deltaY * zoomSpeed;
    const newZoom = Math.min(maxZoom, Math.max(minZoom, keyboardZoom + delta));

    // Get mouse position relative to container
    const rect = keyboardContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Adjust pan to zoom toward mouse position
    const zoomRatio = newZoom / keyboardZoom;
    keyboardPan.x = mouseX - (mouseX - keyboardPan.x) * zoomRatio;
    keyboardPan.y = mouseY - (mouseY - keyboardPan.y) * zoomRatio;

    keyboardZoom = newZoom;
    updateKeyboardTransform();
}

/**
 * Handle mouse down for keyboard panning
 */
function onKeyboardMouseDown(e)
{
    // Middle mouse button or right mouse button for panning
    if (e.button === 1 || e.button === 2)
    {
        e.preventDefault();
        keyboardIsPanning = true;
        keyboardLastPanPos = { x: e.clientX, y: e.clientY };
        keyboardContainer.style.cursor = 'grabbing';
    }
}

/**
 * Handle mouse move for keyboard panning
 */
function onKeyboardMouseMove(e)
{
    if (keyboardIsPanning)
    {
        const dx = e.clientX - keyboardLastPanPos.x;
        const dy = e.clientY - keyboardLastPanPos.y;
        keyboardPan.x += dx;
        keyboardPan.y += dy;
        keyboardLastPanPos = { x: e.clientX, y: e.clientY };
        updateKeyboardTransform();
    }
}

/**
 * Handle mouse up for keyboard panning
 */
function onKeyboardMouseUp(e)
{
    if (keyboardIsPanning)
    {
        keyboardIsPanning = false;
        keyboardContainer.style.cursor = '';
    }
}

/**
 * Handle double-click to reset keyboard view
 */
function onKeyboardDblClick(e)
{
    // Only reset if clicking on the container background, not on a key
    if (e.target === keyboardContainer || e.target.classList.contains('keyboard-layout-wrapper'))
    {
        resetKeyboardView();
    }
}

/**
 * Reset keyboard view to default zoom/pan
 */
function resetKeyboardView()
{
    keyboardZoom = 1.0;
    keyboardPan = { x: 0, y: 0 };
    updateKeyboardTransform();
}

// ========================================
// Button Highlighting (from Keybindings Page)
// ========================================

/**
 * Highlight a button in the visual view when clicked from keybindings page
 * @param {string} bindingInput - The binding input string (e.g., "js1_button13", "kb1_f", "gp1_a")
 * @param {string} actionName - The action display name for console logging
 */
window.highlightButtonInJoystickViewer = function (bindingInput, actionName)
{
    console.log('[Joystick Viewer] Highlighting button:', bindingInput, 'for action:', actionName);

    // Clear any existing highlight timeout
    if (highlightTimeout)
    {
        clearTimeout(highlightTimeout);
        highlightTimeout = null;
    }

    // Check what type of input this is
    const isJoystickInput = bindingInput.match(/^(js|gp)\d+_/i);
    const isKeyboardInput = bindingInput.match(/^kb\d+_/i);
    const isMouseInput = bindingInput.match(/^mouse\d+_/i);

    if (isKeyboardInput)
    {
        // Keyboard input - highlight in keyboard view
        highlightKeyInKeyboardView(bindingInput, actionName);
        return;
    }

    if (isMouseInput)
    {
        console.log('[Joystick Viewer] Mouse input highlighting not yet implemented:', bindingInput);
        return;
    }

    if (!isJoystickInput)
    {
        console.warn('[Joystick Viewer] Unknown input type for highlighting:', bindingInput);
        return;
    }

    // Helper to find matching box in current clickableBoxes
    const findMatchingBox = () =>
    {
        for (const box of clickableBoxes)
        {
            if (box.bindings && Array.isArray(box.bindings))
            {
                const hasMatch = box.bindings.some(binding =>
                {
                    // Normalize target input
                    const targetInput = bindingInput.toLowerCase().trim();

                    // 1. Check inputRaw (e.g., "js1_button1")
                    if (binding.inputRaw && binding.inputRaw.toLowerCase().trim() === targetInput) return true;

                    // 2. Check input (display name, e.g., "Joystick 1 - Button 1")
                    if (binding.input && binding.input.toLowerCase().trim() === targetInput) return true;

                    // 3. Check if the binding is a string and matches
                    if (typeof binding === 'string' && binding.toLowerCase().trim() === targetInput) return true;

                    return false;
                });

                if (hasMatch) return box;
            }

            // Also check if the box represents the button itself, even if unbound
            if (box.buttonData)
            {
                try
                {
                    const info = extractButtonIdentifier(box.buttonData);
                    const targetInput = bindingInput.toLowerCase().trim();

                    // Check exact inputString match
                    if (info.inputString && info.inputString.toLowerCase() === targetInput) return true;

                    // Check button number match (e.g., js2_button18)
                    if (info.buttonNum !== null && info.jsPrefix)
                    {
                        const constructedInput = `${info.jsPrefix}button${info.buttonNum}`.toLowerCase();
                        if (constructedInput === targetInput) return true;
                    }
                } catch (e)
                {
                    // Ignore errors during extraction
                }
            }
        }
        return null;
    };

    // 1. Try to find in current view
    let matchingBox = findMatchingBox();

    // 2. If not found, search other pages and templates
    if (!matchingBox)
    {
        console.log('[Joystick Viewer] Button not found on current page, searching other pages and templates...');

        const targetInput = bindingInput.toLowerCase().trim();
        let foundTemplateIndex = -1;
        let foundPageIndex = -1;

        // Helper to check a list of buttons for a match
        const checkButtons = (buttons, devicePrefix) =>
        {
            if (!buttons) return false;
            const jsPrefix = `${devicePrefix}_`;

            for (const button of buttons)
            {
                // Check main button input
                const info = extractButtonIdentifierForSearch(button, devicePrefix);
                if (info.inputString && info.inputString.toLowerCase() === targetInput) return true;
                if (info.buttonNum !== null && info.jsPrefix)
                {
                    const constructedInput = `${info.jsPrefix}button${info.buttonNum}`.toLowerCase();
                    if (constructedInput === targetInput) return true;
                }

                // Check hat directions
                if (button.inputs)
                {
                    const directions = ['up', 'down', 'left', 'right', 'push'];
                    for (const dir of directions)
                    {
                        if (button.inputs[dir])
                        {
                            const hatInfo = extractButtonIdentifierForSearch(button, devicePrefix, dir);
                            if (hatInfo.inputString && hatInfo.inputString.toLowerCase() === targetInput) return true;
                            if (hatInfo.buttonNum !== null && hatInfo.jsPrefix)
                            {
                                const constructedHatInput = `${hatInfo.jsPrefix}button${hatInfo.buttonNum}`.toLowerCase();
                                if (constructedHatInput === targetInput) return true;
                            }
                        }
                    }
                }
            }
            return false;
        };

        // Search all templates and their pages
        for (let t = 0; t < loadedTemplates.length; t++)
        {
            const template = loadedTemplates[t].template;

            // Check pages in this template
            if (template.pages && template.pages.length > 0)
            {
                for (let p = 0; p < template.pages.length; p++)
                {
                    // Skip if it's the current template and current page (already checked)
                    if (t === currentTemplateIndex && p === currentPageIndex) continue;

                    const page = template.pages[p];
                    const devicePrefix = page.device_prefix || page.devicePrefix || `js${page.joystickNumber || 1}`;

                    if (checkButtons(page.buttons, devicePrefix))
                    {
                        foundTemplateIndex = t;
                        foundPageIndex = p;
                        break;
                    }
                }
            } else
            {
                // Legacy structure
                // Skip if it's the current template (already checked current page)
                if (t === currentTemplateIndex)
                {
                    // Check other pages in current legacy template
                    const otherPage = currentPageIndex === 0 ? 1 : 0;
                    const stick = otherPage === 0 ? template.leftStick : template.rightStick;
                    const devicePrefix = stick?.device_prefix || stick?.devicePrefix || `js${otherPage + 1}`;

                    if (checkButtons(stick?.buttons || stick, devicePrefix))
                    {
                        foundTemplateIndex = t;
                        foundPageIndex = otherPage;
                        break;
                    }
                    continue;
                }

                // Check other legacy templates
                // 1. Check main buttons
                if (checkButtons(template.buttons, template.device_prefix || template.devicePrefix || 'js1'))
                {
                    foundTemplateIndex = t;
                    foundPageIndex = 0;
                    break;
                }
                // 2. Check left stick
                const leftStick = template.leftStick;
                if (checkButtons(leftStick?.buttons || leftStick, leftStick?.device_prefix || leftStick?.devicePrefix || 'js1'))
                {
                    foundTemplateIndex = t;
                    foundPageIndex = 0;
                    break;
                }
                // 3. Check right stick
                const rightStick = template.rightStick;
                if (checkButtons(rightStick?.buttons || rightStick, rightStick?.device_prefix || rightStick?.devicePrefix || 'js2'))
                {
                    foundTemplateIndex = t;
                    foundPageIndex = 1;
                    break;
                }
            }

            if (foundTemplateIndex !== -1) break;
        }

        // If found, switch to it
        if (foundTemplateIndex !== -1)
        {
            console.log(`[Joystick Viewer] Found button on template ${foundTemplateIndex}, page ${foundPageIndex}. Switching...`);

            // 1. Switch template if needed
            if (foundTemplateIndex !== currentTemplateIndex)
            {
                switchTemplate(foundTemplateIndex);
                // Force UI update for tabs
                updateTemplateTabs();
            }

            // 2. Switch page if needed
            // We need to wait a bit for the template to load if we switched
            const switchPageAction = () =>
            {
                if (foundPageIndex !== currentPageIndex)
                {
                    switchPage(foundPageIndex);
                }

                // 3. Highlight the box
                setTimeout(() =>
                {
                    matchingBox = findMatchingBox();
                    if (matchingBox)
                    {
                        highlightBox(matchingBox);
                    } else
                    {
                        console.warn('[Joystick Viewer] Switched page but still could not find matching box');
                        // One last try with a longer delay
                        setTimeout(() =>
                        {
                            matchingBox = findMatchingBox();
                            if (matchingBox) highlightBox(matchingBox);
                        }, 300);
                    }
                }, 200);
            };

            if (foundTemplateIndex !== currentTemplateIndex)
            {
                // Longer delay for template switch as it involves image loading
                setTimeout(switchPageAction, 400);
            } else
            {
                switchPageAction();
            }
            return;
        }
    }

    if (matchingBox)
    {
        highlightBox(matchingBox);
    }
    else
    {
        console.warn('[Joystick Viewer] No matching button found for input:', bindingInput);
        // Force a redraw just in case
        if (clickableBoxes.length === 0) resizeViewerCanvas();
    }
};

function highlightBox(box)
{
    console.log('[Joystick Viewer] Found matching box to highlight:', box);

    // Set the selected box for highlighting
    selectedBox = box;
    isPulsing = true; // Enable pulsing for external highlights

    // Redraw the canvas to show the highlight
    resizeViewerCanvas();

    // Pan to center the highlighted box in view
    panToBox(box);

    // Clear the highlight after 5 seconds
    highlightTimeout = setTimeout(() =>
    {
        selectedBox = null;
        isPulsing = false;
        resizeViewerCanvas();
        highlightTimeout = null;
        console.log('[Joystick Viewer] Highlight cleared');
    }, 5000);
}

/**
 * Highlight a key in the keyboard view
 * @param {string} bindingInput - The keyboard binding input string (e.g., "kb1_f")
 * @param {string} actionName - The action display name
 */
function highlightKeyInKeyboardView(bindingInput, actionName)
{
    console.log('[Keyboard View] Highlighting key:', bindingInput, 'for action:', actionName);

    // Extract the key from the binding (e.g., "kb1_f" -> "f")
    const match = bindingInput.match(/^kb\d+_(.+)$/i);
    if (!match)
    {
        console.warn('[Keyboard View] Could not parse key from binding:', bindingInput);
        return;
    }

    const keyCode = match[1]; // e.g., "f", "lalt", "space", etc.

    // Find the key element in the keyboard layout
    const keyElement = document.querySelector(`.keyboard-key[data-key="${keyCode}"], .keyboard-key[data-key="${keyCode.toUpperCase()}"]`);

    if (keyElement)
    {
        // Add highlight class
        keyElement.classList.add('key-highlighted');

        // Also highlight the action text if present
        const actionTextElements = keyElement.querySelectorAll('.key-binding-action');
        actionTextElements.forEach(el => el.classList.add('action-highlighted'));

        // Clear highlight after 5 seconds
        highlightTimeout = setTimeout(() =>
        {
            keyElement.classList.remove('key-highlighted');
            actionTextElements.forEach(el => el.classList.remove('action-highlighted'));
            highlightTimeout = null;
            console.log('[Keyboard View] Highlight cleared');
        }, 5000);
    }
    else
    {
        console.warn('[Keyboard View] Key element not found for:', keyCode);
    }
}

/**
 * Pan the canvas to center a box in view
 * @param {Object} box - The box to pan to (with x, y, width, height properties)
 */
function panToBox(box)
{
    if (!box || !canvas) return;

    const container = document.getElementById('viewer-canvas-container');
    if (!container) return;

    const rect = container.getBoundingClientRect();

    // Calculate the center of the box in canvas coordinates
    const boxCenterX = box.x + box.width / 2;
    const boxCenterY = box.y + box.height / 2;

    // Calculate the center of the viewport
    const viewportCenterX = rect.width / 2;
    const viewportCenterY = rect.height / 2;

    // Calculate the pan needed to center the box
    // We need to account for current zoom
    pan.x = viewportCenterX - (boxCenterX * zoom);
    pan.y = viewportCenterY - (boxCenterY * zoom);

    // Redraw with new pan
    resizeViewerCanvas();
}

// Initialize on DOM ready
if (document.readyState === 'loading')
{
    document.addEventListener('DOMContentLoaded', initKeyboardView);
}
else
{
    initKeyboardView();
}

// Export refresh function for use when bindings change
window.refreshKeyboardView = function ()
{
    if (keyboardViewVisible && keyboardContainer)
    {
        refreshKeyboardBindings();
    }
};

// Export reset function
window.resetKeyboardView = resetKeyboardView;