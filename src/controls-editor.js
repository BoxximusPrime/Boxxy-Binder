/**
 * Controls Editor Module
 * 
 * Provides an editor for Star Citizen control options including:
 * - Inversion settings
 * - Sensitivity curves (nonlinearity_curve)
 * - Exponent values
 * 
 * Supports keyboard, gamepad, and joystick option trees.
 */

const { invoke } = window.__TAURI__.core;

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let controlsData = null; // Parsed optiontree data
let currentDeviceType = 'keyboard'; // 'keyboard', 'gamepad', 'joystick'
let currentGamepadInstance = 1; // For gamepad, which instance (1-8)
let currentJoystickInstance = 1; // For joystick, which instance (1-8)
let selectedNode = null; // Currently selected node in tree
let hasUnsavedChanges = false;

// User's custom settings (overrides for default values)
let userSettings = {
    keyboard: {},
    gamepad: {}, // Each key is instance number, value is settings object
    joystick: {} // Each key is instance number, value is settings object
};

// Debounce timer for syncing settings to backend
let syncDebounceTimer = null;
const SYNC_DEBOUNCE_MS = 500; // Wait 500ms after last change before syncing

/**
 * Sync control settings to backend (debounced)
 * This ensures settings persist across page refreshes
 */
function debouncedSyncToBackend()
{
    if (syncDebounceTimer)
    {
        clearTimeout(syncDebounceTimer);
    }

    syncDebounceTimer = setTimeout(async () =>
    {
        try
        {
            const controlOptions = window.getAllControlOptions();
            if (controlOptions && controlOptions.length > 0)
            {
                console.log('[CONTROLS-EDITOR] Syncing control options to backend:', controlOptions.length, 'items');
                await invoke('update_control_options', { controlOptions });

                // Mark as having unsaved changes in localStorage so it persists across refresh
                localStorage.setItem('hasUnsavedChanges', 'true');
                console.log('[CONTROLS-EDITOR] Set hasUnsavedChanges to true in localStorage');

                // Also update the cache so settings persist across refresh
                if (window.cacheUserCustomizations)
                {
                    await window.cacheUserCustomizations();
                    console.log('[CONTROLS-EDITOR] Cache updated, localStorage.hasUnsavedChanges =', localStorage.getItem('hasUnsavedChanges'));
                }
            }
        }
        catch (error)
        {
            console.error('[CONTROLS-EDITOR] Error syncing to backend:', error);
        }
    }, SYNC_DEBOUNCE_MS);
}

// Current controls file path (for "Save" vs "Save As")
let currentControlsFilePath = null;

// ============================================================================
// INITIALIZATION
// ============================================================================

window.initializeControlsEditor = async function ()
{
    console.log('[CONTROLS-EDITOR] Initializing...');

    // Set up event listeners
    setupDeviceTabListeners();
    setupControlsToolbarListeners();

    // Parse optiontree data from AllBinds.xml
    await loadControlsData();

    // Render initial view
    renderDeviceTabs();
    renderTree();

    // Update file label
    updateControlsFileLabel();

    console.log('[CONTROLS-EDITOR] Initialization complete');
};

function setupDeviceTabListeners()
{
    const tabContainer = document.getElementById('controls-device-tabs');
    if (!tabContainer) return;

    tabContainer.addEventListener('click', (e) =>
    {
        const tab = e.target.closest('.controls-device-tab');
        if (!tab) return;

        const deviceId = tab.dataset.device;
        if (deviceId)
        {
            // Check if this is already the active tab
            let currentActiveId = currentDeviceType;
            if (currentDeviceType === 'joystick')
            {
                currentActiveId = `joystick${currentJoystickInstance}`;
            } else if (currentDeviceType === 'gamepad')
            {
                currentActiveId = `gamepad${currentGamepadInstance}`;
            }

            if (deviceId !== currentActiveId)
            {
                switchDeviceType(deviceId);
            }
        }
    });
}

function setupControlsToolbarListeners()
{
    const loadBtn = document.getElementById('controls-load-btn');
    const saveBtn = document.getElementById('controls-save-btn');
    const saveAsBtn = document.getElementById('controls-save-as-btn');
    const importBtn = document.getElementById('controls-import-btn');
    const applyBtn = document.getElementById('controls-apply-btn');

    if (loadBtn) loadBtn.addEventListener('click', loadControlsFile);
    if (saveBtn) saveBtn.addEventListener('click', saveControlsFile);
    if (saveAsBtn) saveAsBtn.addEventListener('click', saveControlsFileAs);
    if (importBtn) importBtn.addEventListener('click', importControlsFromSC);
    if (applyBtn) applyBtn.addEventListener('click', applyControlsToSC);
}

function updateControlsFileLabel()
{
    const label = document.getElementById('controls-file-label');
    if (!label) return;

    if (currentControlsFilePath)
    {
        const fileName = currentControlsFilePath.split(/[/\\]/).pop();
        label.textContent = fileName;
        label.classList.add('has-file');
    }
    else
    {
        label.textContent = 'No controls file loaded';
        label.classList.remove('has-file');
    }
}

// ============================================================================
// CONTROLS FILE OPERATIONS
// ============================================================================

async function loadControlsFile()
{
    try
    {
        const { open } = window.__TAURI__.dialog;

        const filePath = await open({
            filters: [{
                name: 'SC Controls',
                extensions: ['sccontrols', 'json']
            }],
            multiple: false
        });

        if (!filePath) return; // User cancelled

        const loadedData = await invoke('load_controls_file', { filePath });

        // Load into the editor
        if (window.loadControlsFromFile)
        {
            window.loadControlsFromFile(loadedData);
        }

        // Update state
        currentControlsFilePath = filePath;
        hasUnsavedChanges = false;
        updateControlsFileLabel();
        updateSaveIndicator();

        if (window.toast)
        {
            window.toast.success(`Loaded: ${filePath.split(/[/\\]/).pop()}`);
        }

        console.log('[CONTROLS-EDITOR] Loaded controls from:', filePath);
    }
    catch (error)
    {
        console.error('[CONTROLS-EDITOR] Error loading controls file:', error);
        if (window.showAlert)
        {
            await window.showAlert(`Failed to load controls file: ${error}`, 'Error');
        }
    }
}

async function saveControlsFile()
{
    if (!currentControlsFilePath)
    {
        // No current file, redirect to Save As
        await saveControlsFileAs();
        return;
    }

    try
    {
        const settings = window.getControlsForSaving();
        const profileName = currentControlsFilePath.split(/[/\\]/).pop().replace(/\.[^.]+$/, '');

        await invoke('save_controls_file', {
            filePath: currentControlsFilePath,
            profileName,
            settings
        });

        hasUnsavedChanges = false;
        updateSaveIndicator();

        if (window.toast)
        {
            window.toast.success('Controls saved!');
        }

        console.log('[CONTROLS-EDITOR] Saved controls to:', currentControlsFilePath);
    }
    catch (error)
    {
        console.error('[CONTROLS-EDITOR] Error saving controls file:', error);
        if (window.showAlert)
        {
            await window.showAlert(`Failed to save controls file: ${error}`, 'Error');
        }
    }
}

async function saveControlsFileAs()
{
    try
    {
        const { save } = window.__TAURI__.dialog;

        const filePath = await save({
            filters: [{
                name: 'SC Controls',
                extensions: ['sccontrols']
            }],
            defaultPath: 'my_controls.sccontrols'
        });

        if (!filePath) return; // User cancelled

        const settings = window.getControlsForSaving();
        const profileName = filePath.split(/[/\\]/).pop().replace(/\.[^.]+$/, '');

        await invoke('save_controls_file', {
            filePath,
            profileName,
            settings
        });

        // Update state
        currentControlsFilePath = filePath;
        hasUnsavedChanges = false;
        updateControlsFileLabel();
        updateSaveIndicator();

        if (window.toast)
        {
            window.toast.success(`Saved: ${filePath.split(/[/\\]/).pop()}`);
        }

        console.log('[CONTROLS-EDITOR] Saved controls to:', filePath);
    }
    catch (error)
    {
        console.error('[CONTROLS-EDITOR] Error saving controls file:', error);
        if (window.showAlert)
        {
            await window.showAlert(`Failed to save controls file: ${error}`, 'Error');
        }
    }
}

async function importControlsFromSC()
{
    try
    {
        // Get SC installation directory
        const scInstallDirectory = localStorage.getItem('scInstallDirectory');

        if (!scInstallDirectory)
        {
            // Show dialog asking to configure or browse
            const result = await showInstallationSelectDialog(
                'Import Controls from Star Citizen',
                'Select which Star Citizen installation to import control settings from:',
                'import'
            );

            if (!result) return; // User cancelled

            await performImport(result);
            return;
        }

        // Scan for installations
        const installations = await invoke('scan_sc_installations', { basePath: scInstallDirectory });

        if (installations.length === 0)
        {
            // No installations found, offer to browse
            const result = await showInstallationSelectDialog(
                'Import Controls from Star Citizen',
                'No Star Citizen installations found. Browse for the actionmaps.xml file:',
                'import'
            );

            if (!result) return;
            await performImport(result);
            return;
        }

        if (installations.length === 1)
        {
            // Only one installation, use it directly
            const actionmapsPath = await invoke('find_actionmaps_path', { basePath: installations[0].path });
            if (actionmapsPath)
            {
                await performImport(actionmapsPath);
            }
            else
            {
                if (window.showAlert)
                {
                    await window.showAlert(`No actionmaps.xml found in ${installations[0].name}. The game may not have been run yet.`, 'Import Controls');
                }
            }
            return;
        }

        // Multiple installations - show selection dialog
        const result = await showInstallationSelectDialog(
            'Import Controls from Star Citizen',
            'Select which Star Citizen installation to import control settings from:',
            'import',
            installations
        );

        if (!result) return;
        await performImport(result);
    }
    catch (error)
    {
        console.error('[CONTROLS-EDITOR] Error importing controls:', error);
        if (window.showAlert)
        {
            await window.showAlert(`Failed to import controls: ${error}`, 'Error');
        }
    }
}

async function performImport(actionmapsPath)
{
    const loadedData = await invoke('import_controls_from_actionmaps', { actionmapsPath });

    // Load into the editor
    if (window.loadControlsFromFile)
    {
        window.loadControlsFromFile(loadedData);
    }

    // Don't set currentControlsFilePath - this is imported data, not from a controls file
    hasUnsavedChanges = true;
    updateSaveIndicator();

    // Get installation name from path for the toast
    const pathParts = actionmapsPath.split(/[/\\]/);
    const installIdx = pathParts.findIndex(p => p === 'StarCitizen');
    const installName = installIdx >= 0 && pathParts[installIdx + 1] ? pathParts[installIdx + 1] : 'Star Citizen';

    if (window.toast)
    {
        window.toast.success(`Imported control settings from ${installName}!`);
    }

    console.log('[CONTROLS-EDITOR] Imported controls from:', actionmapsPath);
}

/**
 * Show installation selection dialog
 * @param {string} title - Dialog title
 * @param {string} message - Dialog message
 * @param {string} mode - 'import' or 'apply'
 * @param {Array} installations - Array of installation objects (optional)
 * @returns {Promise<string|null>} - Path to actionmaps.xml or null if cancelled
 */
async function showInstallationSelectDialog(title, message, mode, installations = null)
{
    return new Promise(async (resolve) =>
    {
        const modal = document.getElementById('installation-select-modal');
        const titleEl = document.getElementById('installation-select-title');
        const messageEl = document.getElementById('installation-select-message');
        const listEl = document.getElementById('installation-select-list');
        const notConfiguredEl = document.getElementById('installation-select-not-configured');
        const cancelBtn = document.getElementById('installation-select-cancel-btn');
        const browseBtn = document.getElementById('installation-select-browse-btn');

        // Set title and message
        titleEl.textContent = mode === 'import' ? '📥 ' + title : '🚀 ' + title;
        messageEl.textContent = message;

        // Clear previous list
        listEl.innerHTML = '';
        notConfiguredEl.style.display = 'none';

        // Cleanup function
        const cleanup = () =>
        {
            modal.style.display = 'none';
            cancelBtn.removeEventListener('click', handleCancel);
            browseBtn.removeEventListener('click', handleBrowse);
            document.removeEventListener('keydown', handleEscape);
        };

        const handleCancel = () =>
        {
            cleanup();
            resolve(null);
        };

        const handleBrowse = async () =>
        {
            cleanup();

            const { open } = window.__TAURI__.dialog;
            const filePath = await open({
                filters: [{
                    name: 'Star Citizen Settings',
                    extensions: ['xml']
                }],
                multiple: false,
                title: 'Select actionmaps.xml from Star Citizen'
            });

            resolve(filePath || null);
        };

        const handleEscape = (e) =>
        {
            if (e.key === 'Escape')
            {
                handleCancel();
            }
        };

        // Add installation buttons if we have them
        if (installations && installations.length > 0)
        {
            for (const install of installations)
            {
                const btn = document.createElement('button');
                btn.className = 'btn btn-secondary installation-select-btn';
                btn.style.cssText = 'display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; text-align: left; width: 100%;';
                btn.innerHTML = `
                    <span style="font-size: 1.5rem;">🚀</span>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; color: #4ec9b0;">${install.name}</div>
                        <div style="font-size: 0.8rem; color: var(--text-secondary); font-family: 'Consolas', monospace; overflow: hidden; text-overflow: ellipsis;">${install.path}</div>
                    </div>
                `;

                btn.addEventListener('click', async () =>
                {
                    cleanup();

                    try
                    {
                        const actionmapsPath = await invoke('find_actionmaps_path', { basePath: install.path });
                        if (actionmapsPath)
                        {
                            resolve(actionmapsPath);
                        }
                        else
                        {
                            if (window.showAlert)
                            {
                                await window.showAlert(`No actionmaps.xml found in ${install.name}. The game may not have been run yet.`, 'Import Controls');
                            }
                            resolve(null);
                        }
                    }
                    catch (error)
                    {
                        console.error('Error finding actionmaps.xml:', error);
                        resolve(null);
                    }
                });

                listEl.appendChild(btn);
            }
        }
        else
        {
            // No installations configured
            notConfiguredEl.style.display = 'block';
        }

        // Add event listeners
        cancelBtn.addEventListener('click', handleCancel);
        browseBtn.addEventListener('click', handleBrowse);
        document.addEventListener('keydown', handleEscape);

        // Show modal
        modal.style.display = 'flex';
    });
}

async function applyControlsToSC()
{
    try
    {
        // Check if there are any settings to apply
        if (!window.hasControlSettings || !window.hasControlSettings())
        {
            if (window.showAlert)
            {
                await window.showAlert('No control settings to apply. Configure some settings first.', 'Apply Controls');
            }
            return;
        }

        // Get SC installation directory
        const scInstallDirectory = localStorage.getItem('scInstallDirectory');
        let actionmapsPath = null;

        if (!scInstallDirectory)
        {
            // Show dialog asking to configure or browse
            actionmapsPath = await showInstallationSelectDialog(
                'Apply Controls to Star Citizen',
                'Select which Star Citizen installation to apply control settings to:',
                'apply'
            );

            if (!actionmapsPath) return;
        }
        else
        {
            // Scan for installations
            const installations = await invoke('scan_sc_installations', { basePath: scInstallDirectory });

            if (installations.length === 0)
            {
                // No installations found, offer to browse
                actionmapsPath = await showInstallationSelectDialog(
                    'Apply Controls to Star Citizen',
                    'No Star Citizen installations found. Browse for the actionmaps.xml file:',
                    'apply'
                );

                if (!actionmapsPath) return;
            }
            else if (installations.length === 1)
            {
                // Only one installation, use it directly
                actionmapsPath = await invoke('find_actionmaps_path', { basePath: installations[0].path });
                if (!actionmapsPath)
                {
                    if (window.showAlert)
                    {
                        await window.showAlert(`No actionmaps.xml found in ${installations[0].name}. The game may not have been run yet.`, 'Apply Controls');
                    }
                    return;
                }
            }
            else
            {
                // Multiple installations - show selection dialog
                actionmapsPath = await showInstallationSelectDialog(
                    'Apply Controls to Star Citizen',
                    'Select which Star Citizen installation to apply control settings to:',
                    'apply',
                    installations
                );

                if (!actionmapsPath) return;
            }
        }

        // Get installation name from path for the confirmation dialog
        const pathParts = actionmapsPath.split(/[/\\]/);
        const installIdx = pathParts.findIndex(p => p === 'StarCitizen');
        const installName = installIdx >= 0 && pathParts[installIdx + 1] ? pathParts[installIdx + 1] : 'Star Citizen';

        // Show confirmation dialog
        const confirmed = await window.showConfirmation(
            `This will modify your ${installName} actionmaps.xml file directly.\n\n` +
            '⚠️ A backup will be created automatically.\n\n' +
            '🔄 You will need to restart Star Citizen for changes to take effect.\n\n' +
            'Continue?',
            'Apply Controls to Star Citizen'
        );

        if (!confirmed) return;

        const settings = window.getControlsForSaving();
        const profileName = currentControlsFilePath
            ? currentControlsFilePath.split(/[/\\]/).pop().replace(/\.[^.]+$/, '')
            : 'SC Joy Mapper';

        const result = await invoke('apply_controls_to_actionmaps', {
            actionmapsPath,
            settings,
            profileName
        });

        if (result.success)
        {
            if (window.toast)
            {
                window.toast.success(result.message, { duration: 5000 });
            }
            else if (window.showAlert)
            {
                await window.showAlert(result.message, 'Success');
            }
        }
        else
        {
            if (window.showAlert)
            {
                await window.showAlert(result.message, 'Error');
            }
        }

        console.log('[CONTROLS-EDITOR] Applied controls to SC:', result);
    }
    catch (error)
    {
        console.error('[CONTROLS-EDITOR] Error applying controls:', error);
        if (window.showAlert)
        {
            await window.showAlert(`Failed to apply controls: ${error}`, 'Error');
        }
    }
}

// ============================================================================
// DATA LOADING
// ============================================================================

async function loadControlsData()
{
    try
    {
        // Get the parsed optiontree data from the backend
        const data = await invoke('get_control_options');
        controlsData = data;
        console.log('[CONTROLS-EDITOR] Loaded control options:', controlsData);
    } catch (error)
    {
        console.error('[CONTROLS-EDITOR] Error loading control options:', error);
        // If backend doesn't have this endpoint yet, we'll parse from the frontend
        await loadControlsDataFromXml();
    }
}

async function loadControlsDataFromXml()
{
    // Fallback: Parse optiontree data from the AllBinds.xml file
    // This would be called if the backend doesn't have the get_control_options command yet
    try
    {
        const xmlContent = await invoke('get_all_binds_xml');
        controlsData = parseOptionTreesFromXml(xmlContent);
        console.log('[CONTROLS-EDITOR] Parsed control options from XML:', controlsData);
    } catch (error)
    {
        console.error('[CONTROLS-EDITOR] Error parsing XML:', error);
        controlsData = getDefaultControlsData();
    }
}

function parseOptionTreesFromXml(xmlString)
{
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

    const result = {
        keyboard: null,
        gamepad: null,
        joystick: null
    };

    const optionTrees = xmlDoc.querySelectorAll('optiontree');

    optionTrees.forEach(tree =>
    {
        const type = tree.getAttribute('type');
        if (type && result.hasOwnProperty(type))
        {
            // Parse the raw structure
            const rawData = parseOptionGroup(tree, type);
            rawData.instances = parseInt(tree.getAttribute('instances')) || 1;
            rawData.sensitivityMin = parseFloat(tree.getAttribute('UISensitivityMin')) || 0.01;
            rawData.sensitivityMax = parseFloat(tree.getAttribute('UISensitivityMax')) || 2.0;

            // Transform to match Star Citizen's display hierarchy
            result[type] = transformToSCHierarchy(rawData, type);
        }
    });

    return result;
}

function parseOptionGroup(element, deviceType, parentPath = '')
{
    const node = {
        name: element.getAttribute('name') || 'root',
        label: element.getAttribute('UILabel') || element.getAttribute('name') || 'Unknown',
        path: parentPath ? `${parentPath}.${element.getAttribute('name')}` : element.getAttribute('name'),
        deviceType: deviceType,
        showInvert: parseVisibility(element.getAttribute('UIShowInvert')),
        showCurve: parseVisibility(element.getAttribute('UIShowCurve')),
        showSensitivity: parseVisibility(element.getAttribute('UIShowSensitivity')),
        invert: element.getAttribute('invert') === '1',
        invertCvar: element.getAttribute('invert_cvar') || null,
        exponent: parseFloat(element.getAttribute('exponent')) || null,
        curve: null,
        children: []
    };

    // Parse nonlinearity_curve if present
    const curveElement = element.querySelector(':scope > nonlinearity_curve');
    if (curveElement)
    {
        node.curve = parseCurve(curveElement);
    }

    // Parse child optiongroups
    const childGroups = element.querySelectorAll(':scope > optiongroup');
    childGroups.forEach(child =>
    {
        node.children.push(parseOptionGroup(child, deviceType, node.path));
    });

    return node;
}

function parseCurve(curveElement)
{
    const points = [];
    const resetAttr = curveElement.getAttribute('reset');

    if (resetAttr === '1')
    {
        return { reset: true, points: [] };
    }

    const pointElements = curveElement.querySelectorAll('point');
    pointElements.forEach(point =>
    {
        points.push({
            in: parseFloat(point.getAttribute('in')),
            out: parseFloat(point.getAttribute('out'))
        });
    });

    return { reset: false, points };
}

function parseVisibility(attr)
{
    // -1 = inherit from parent (show)
    // 0 = hide
    // 1 = show
    if (attr === null || attr === undefined) return null;
    const val = parseInt(attr);
    if (val === -1) return 'inherit';
    if (val === 0) return false;
    if (val === 1) return true;
    return null;
}

// ============================================================================
// LABEL MAPPINGS - Match Star Citizen's in-game display
// ============================================================================

/**
 * Maps XML UILabel values (e.g., @ui_COFPS) to human-readable Star Citizen labels.
 * Based on actual in-game OPTIONS MENU → CONTROLS screen.
 */
const SC_LABEL_MAP = {
    // Top-level sections
    '@ui_COInversionSettings': 'Inversion Settings',
    '@ui_COMasterSensitivityCurvesMouse': 'Mouse Sensitivity Curves',
    '@ui_COMasterSensitivityCurvesThumb': 'Thumbstick Sensitivity Curves',
    '@ui_COMasterSensitivityCurvesJoystick': 'Joystick Sensitivity Curves',
    '@ui_COMasterSensitivity': 'Master Sensitivity',

    // Categories
    '@ui_COFPS': 'On Foot',
    '@ui_co_eva': 'FPS EVA',
    '@ui_COFlight': 'Flight',
    '@ui_COTurret': 'Turrets',
    '@ui_COTurretAim': 'Turrets',
    '@ui_COMannedGroundVehicle': 'Ground Vehicle',
    '@ui_COMining': 'Mining',
    '@ui_aiming': 'Aiming and Weapons',
    '@ui_COAnyVehicle': 'Any Vehicle',

    // On Foot / FPS
    '@ui_COFPSView': 'On Foot View',
    '@ui_COFPSViewPitch': 'On Foot (Pitch)',
    '@ui_COFPSViewYaw': 'On Foot (Yaw)',
    '@ui_COFPSMove': 'FPS Movement',
    '@ui_COFPSMoveLeftRight': 'Move Left/Right',
    '@ui_COFPSMoveForwardBackward': 'Move Forward/Backward',

    // EVA
    '@ui_co_eva_roll': 'EVA Roll',
    '@ui_co_eva_move_strafe_lateral': 'EVA Strafe Lateral',
    '@ui_co_eva_move_strafe_longitudinal': 'EVA Strafe Longitudinal',
    '@ui_co_eva_move_strafe_vertical': 'EVA Strafe Vertical',

    // Flight categories
    '@ui_COFlightMove': 'Flight Movement',
    '@ui_COFreeLook': 'Free Look Mode',
    '@ui_COThrottleSensitivity': 'Throttle',

    // Flight movement
    '@ui_COFlightPitch': 'Flight (Pitch)',
    '@ui_COFlightYaw': 'Flight (Yaw)',
    '@ui_COFlightRoll': 'Flight (Roll)',
    '@ui_COStrafeUpDown': 'Strafe Up/Down',
    '@ui_COStrafeLeftRight': 'Strafe Left/Right',
    '@ui_v_strafe_longitudinal': 'Strafe Longitudinal',
    '@ui_v_strafe_forward': 'Strafe Forward',
    '@ui_v_strafe_back': 'Strafe Backward',
    '@ui_co_flight_move_speed_range_abs': 'Speed Limiter (abs)',
    '@ui_co_flight_move_speed_range_rel': 'Velocity Limiter (rel)',
    '@ui_co_flight_move_accel_range_abs': 'Acceleration Limiter (abs)',
    '@ui_co_flight_move_accel_range_rel': 'Acceleration Limiter (rel)',
    '@ui_co_flight_move_space_brake': 'Space Brake',

    // Flight view / Free Look
    '@ui_COFlightViewY': 'Flight View (Pitch)',
    '@ui_COFlightViewX': 'Flight View (Yaw)',
    '@ui_co_dynamic_zoom_rel': 'Dynamic Zoom (rel)',
    '@ui_co_dynamic_zoom_abs': 'Dynamic Zoom (abs)',

    // Throttle
    '@ui_COFlightThrustAbsHalf': 'Thrust (Half)',
    '@ui_COFlightThrustAbsFull': 'Thrust (Full)',

    // Turret
    '@ui_COTurretAimPitch': 'Turret Aim (Pitch)',
    '@ui_COTurretAimYaw': 'Turret Aim (Yaw)',
    '@ui_CO_Turret_VJMode': 'Turret Virtual Joystick Mode',
    '@ui_CO_Turret_VJoyModePitch': 'Turret VJoy (Pitch)',
    '@ui_CO_Turret_VJoyModeYaw': 'Turret VJoy (Yaw)',
    '@ui_COTurretRelativeMode': 'Turret Relative Mode',
    '@ui_CO_TurretRelativeModePitch': 'Turret Relative (Pitch)',
    '@ui_CO_TurretRelativeModeYaw': 'Turret Relative (Yaw)',
    '@ui_CO_TurretLimiterRelative': 'Turret Limiter (rel)',
    '@ui_CO_TurretLimiterAbsolute': 'Turret Limiter (abs)',

    // Ground Vehicle
    '@ui_COGroundVehicleViewY': 'Vehicle View (Pitch)',
    '@ui_COGroundVehicleViewX': 'Vehicle View (Yaw)',
    '@ui_COGroundVehicleMove': 'Vehicle Move',
    '@ui_COGroundVehicleMoveForward': 'Vehicle Move Forward',
    '@ui_COGroundVehicleMoveBackward': 'Vehicle Move Backward',
    '@ui_COMGVPitch': 'Vehicle (Pitch)',
    '@ui_COMGVYaw': 'Vehicle (Yaw)',

    // Any Vehicle modes (Mouse specific)
    '@ui_COVJMode': 'Virtual Joystick Mode',
    '@ui_COVJModePitch': 'VJoy Mode (Pitch)',
    '@ui_COVJModeYaw': 'VJoy Mode (Yaw)',
    '@ui_COVJModeRoll': 'VJoy Mode (Roll)',
    '@ui_COVJFixedMode': 'Virtual Joystick Fixed Mode',
    '@ui_COVJFixedModePitch': 'VJoy Fixed (Pitch)',
    '@ui_COVJFixedModeYaw': 'VJoy Fixed (Yaw)',
    '@ui_COVJFixedModeRoll': 'VJoy Fixed (Roll)',
    '@ui_CORelativeMode': 'Relative Mode',
    '@ui_CORelativeModePitch': 'Relative (Pitch)',
    '@ui_CORelativeModeYaw': 'Relative (Yaw)',
    '@ui_CORelativeModeRoll': 'Relative (Roll)',
    '@ui_COAimMode': 'Aim Mode',
    '@ui_COAimModePitch': 'Aim Mode (Pitch)',
    '@ui_COAimModeYaw': 'Aim Mode (Yaw)',

    // Mining
    '@ui_COMiningThrottle': 'Mining Throttle',

    // Aiming / Weapons
    '@ui_weapon_convergence_distance_rel': 'Weapon Convergence (rel)',
    '@ui_weapon_convergence_distance_abs': 'Weapon Convergence (abs)',
};

/**
 * Get the Star Citizen display label for a node
 */
function getDisplayLabel(node)
{
    if (!node || !node.label) return 'Unknown';

    // Check if we have a mapped label
    if (SC_LABEL_MAP[node.label])
    {
        return SC_LABEL_MAP[node.label];
    }

    // Fall back to cleaning up the label
    if (node.label.startsWith('@ui_'))
    {
        return cleanupLabel(node.label);
    }

    return node.label;
}

/**
 * Transform the parsed XML hierarchy to match Star Citizen's display structure.
 * SC shows a flattened view that skips intermediate container nodes.
 */
function transformToSCHierarchy(rawData, deviceType)
{
    if (!rawData) return null;

    // Navigate to the relevant content node, skipping wrapper nodes
    // XML structure: root > master > [mouse_curves|thumbstick_curves|joystick_curves] > inversion > ...
    let contentNode = rawData;

    // Find the curves node (contains the actual settings)
    if (contentNode.children)
    {
        // Find master
        const master = contentNode.children.find(c => c.name === 'master');
        if (master && master.children)
        {
            // Find the curves container
            const curvesNode = master.children.find(c =>
                c.name === 'mouse_curves' ||
                c.name === 'thumbstick_curves' ||
                c.name === 'joystick_curves'
            );
            if (curvesNode)
            {
                contentNode = curvesNode;
            }
        }
    }

    // For joystick/gamepad, we want to show TWO top-level sections:
    // 1. Inversion Settings
    // 2. Sensitivity Curves (same tree but focused on curves)
    // 
    // For mouse/keyboard, we show just the Inversion Settings tree
    // (curves are integrated within each node)

    if (deviceType === 'joystick' || deviceType === 'gamepad')
    {
        // Find the inversion node
        const inversionNode = contentNode.children?.find(c => c.name === 'inversion');
        if (inversionNode)
        {
            // Helper function to mark all descendants with a section type and update paths
            function markSectionType(node, sectionType, pathPrefix = null)
            {
                node.sectionType = sectionType;
                // Update path if a prefix is provided (for curves section)
                // Replace '.inversion.' or '.inversion' at end, or 'inversion.' at start, or just 'inversion'
                if (pathPrefix && node.path)
                {
                    // Handle the inversion segment in the path
                    // Could be: 'inversion', 'inversion.child', 'parent.inversion', 'parent.inversion.child'
                    node.path = node.path
                        .replace(/\.inversion\./, `.${pathPrefix}.`)
                        .replace(/\.inversion$/, `.${pathPrefix}`)
                        .replace(/^inversion\./, `${pathPrefix}.`)
                        .replace(/^inversion$/, pathPrefix);
                }
                if (node.children)
                {
                    node.children.forEach(child => markSectionType(child, sectionType, pathPrefix));
                }
                return node;
            }

            // Deep clone for inversion section
            const inversionClone = JSON.parse(JSON.stringify(inversionNode));
            markSectionType(inversionClone, 'inversion');
            inversionClone.label = '@ui_COInversionSettings';
            inversionClone.isSection = true;

            // Deep clone for curves section - mark as disabled
            const curvesClone = JSON.parse(JSON.stringify(inversionNode));
            markSectionType(curvesClone, 'curves', 'sensitivity_curves');
            curvesClone.name = 'sensitivity_curves';
            curvesClone.label = deviceType === 'joystick' ? '@ui_COMasterSensitivityCurvesJoystick' : '@ui_COMasterSensitivityCurvesThumb';
            curvesClone.path = 'sensitivity_curves';
            curvesClone.isSection = true;
            curvesClone.disabled = true; // Mark as disabled - curves don't persist in SC
            curvesClone.disabledReason = 'Sensitivity curve settings do not persist properly in Star Citizen and have been temporarily disabled.';

            // Mark all children as disabled too
            function markDisabled(node)
            {
                node.disabled = true;
                node.disabledReason = 'Sensitivity curve settings do not persist properly in Star Citizen and have been temporarily disabled.';
                if (node.children)
                {
                    node.children.forEach(child => markDisabled(child));
                }
            }
            markDisabled(curvesClone);

            // Create the two-section structure
            return {
                name: 'root',
                label: deviceType === 'joystick' ? 'Joystick Controls' : 'Gamepad Controls',
                path: 'root',
                deviceType: deviceType,
                children: [inversionClone, curvesClone],
                instances: rawData.instances || 1,
                sensitivityMin: rawData.sensitivityMin,
                sensitivityMax: rawData.sensitivityMax
            };
        }
    }
    else
    {
        // Keyboard/Mouse: Show inversion settings directly (no curves for mouse)
        const inversionNode = contentNode.children?.find(c => c.name === 'inversion');
        if (inversionNode)
        {
            // Helper function to mark all descendants with a section type
            function markSectionType(node, sectionType)
            {
                node.sectionType = sectionType;
                if (node.children)
                {
                    node.children.forEach(child => markSectionType(child, sectionType));
                }
                return node;
            }

            const inversionClone = JSON.parse(JSON.stringify(inversionNode));
            markSectionType(inversionClone, 'inversion');
            inversionClone.label = '@ui_COInversionSettings';
            inversionClone.isSection = true;

            return {
                name: 'root',
                label: 'Mouse Controls',
                path: 'root',
                deviceType: deviceType,
                children: [inversionClone],
                instances: rawData.instances || 1,
                sensitivityMin: rawData.sensitivityMin,
                sensitivityMax: rawData.sensitivityMax
            };
        }
    }

    // Fallback: return as-is
    return rawData;
}

function getDefaultControlsData()
{
    // Minimal fallback data structure
    return {
        keyboard: { name: 'root', label: 'Keyboard Settings', children: [], deviceType: 'keyboard' },
        gamepad: { name: 'root', label: 'Gamepad Settings', children: [], deviceType: 'gamepad' },
        joystick: { name: 'root', label: 'Joystick Settings', children: [], deviceType: 'joystick', instances: 8 }
    };
}

// ============================================================================
// UI RENDERING
// ============================================================================

function renderDeviceTabs()
{
    const tabContainer = document.getElementById('controls-device-tabs');
    if (!tabContainer) return;

    // Get max joysticks and gamepads from window (set by main.js)
    const maxJs = window.getMaxJoysticks ? window.getMaxJoysticks() : 4;
    const maxGp = window.getMaxGamepads ? window.getMaxGamepads() : 4;

    // Build devices array dynamically
    const devices = [
        { id: 'keyboard', icon: '⌨️', label: 'Keyboard' }
    ];

    // Add gamepad tabs based on max gamepads setting
    for (let i = 1; i <= maxGp; i++)
    {
        devices.push({
            id: `gamepad${i}`,
            icon: '🎮',
            label: `Gamepad ${i}`
        });
    }

    // Add joystick tabs based on max joysticks setting
    for (let i = 1; i <= maxJs; i++)
    {
        devices.push({
            id: `joystick${i}`,
            icon: '🕹️',
            label: `Joystick ${i}`
        });
    }

    // Determine active tab (combine deviceType + instance for joysticks/gamepads)
    let activeId = currentDeviceType;
    if (currentDeviceType === 'joystick')
    {
        activeId = `joystick${currentJoystickInstance}`;
    } else if (currentDeviceType === 'gamepad')
    {
        activeId = `gamepad${currentGamepadInstance}`;
    }

    tabContainer.innerHTML = devices.map(device => `
    <button class="controls-device-tab ${device.id === activeId ? 'active' : ''}" 
            data-device="${device.id}">
      <span class="tab-icon">${device.icon}</span>
      <span>${device.label}</span>
    </button>
  `).join('');
}

function switchDeviceType(deviceId)
{
    // Parse instance from deviceId for joysticks and gamepads
    if (deviceId.startsWith('joystick'))
    {
        currentDeviceType = 'joystick';
        currentJoystickInstance = parseInt(deviceId.replace('joystick', '')) || 1;
    }
    else if (deviceId.startsWith('gamepad'))
    {
        currentDeviceType = 'gamepad';
        currentGamepadInstance = parseInt(deviceId.replace('gamepad', '')) || 1;
    }
    else
    {
        currentDeviceType = deviceId;
    }

    selectedNode = null;

    // Update tab states
    let activeId = currentDeviceType;
    if (currentDeviceType === 'joystick')
    {
        activeId = `joystick${currentJoystickInstance}`;
    } else if (currentDeviceType === 'gamepad')
    {
        activeId = `gamepad${currentGamepadInstance}`;
    }
    document.querySelectorAll('.controls-device-tab').forEach(tab =>
    {
        tab.classList.toggle('active', tab.dataset.device === activeId);
    });

    renderTree();
    clearSettingsPanel();
}

function renderTree()
{
    const treeContent = document.getElementById('controls-tree-content');
    if (!treeContent) return;

    if (!controlsData || !controlsData[currentDeviceType])
    {
        treeContent.innerHTML = `
      <div class="controls-empty-state">
        <div class="empty-icon">📭</div>
        <h3>No Options Available</h3>
        <p>Control options for this device type could not be loaded.</p>
      </div>
    `;
        return;
    }

    const rootNode = controlsData[currentDeviceType];
    treeContent.innerHTML = renderTreeNode(rootNode, 0);

    // Add click listeners to tree nodes
    treeContent.querySelectorAll('.controls-tree-node').forEach(node =>
    {
        node.addEventListener('click', (e) =>
        {
            e.stopPropagation();
            const path = node.dataset.path;
            selectTreeNode(path);
        });
    });

    // Add click listeners to expand toggles
    treeContent.querySelectorAll('.controls-tree-expand').forEach(toggle =>
    {
        toggle.addEventListener('click', (e) =>
        {
            e.stopPropagation();
            toggleTreeExpand(toggle);
        });
    });

    // Initialize tooltips for disabled nodes
    import('./tooltip.js').then(module =>
    {
        const Tooltip = module.Tooltip;
        treeContent.querySelectorAll('.controls-tree-node.disabled[data-tooltip]').forEach(node =>
        {
            const tooltipText = node.getAttribute('data-tooltip');
            new Tooltip(node, tooltipText);
        });
    }).catch(err => console.error('[CONTROLS-EDITOR] Error loading tooltip module:', err));
}

function renderTreeNode(node, depth)
{
    if (!node) return '';

    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = depth < 2; // Auto-expand first 2 levels
    const isSection = node.isSection === true;
    const isDisabled = node.disabled === true;

    // Get display label using our SC label map
    const displayLabel = getDisplayLabel(node);

    // Section nodes get special styling
    const nodeClasses = [
        'controls-tree-node',
        hasChildren ? 'has-children' : '',
        isSection ? 'section-header' : '',
        isDisabled ? 'disabled' : ''
    ].filter(Boolean).join(' ');

    // Add tooltip for disabled nodes
    const tooltipAttr = isDisabled && node.disabledReason ? `data-tooltip="${node.disabledReason}"` : '';

    let html = `
    <div class="controls-tree-item ${isSection ? 'section-item' : ''}" data-path="${node.path}">
      <div class="${nodeClasses}" data-path="${node.path}" ${tooltipAttr}>
        ${hasChildren ? `
          <span class="controls-tree-expand ${isExpanded ? 'expanded' : ''}">▶</span>
        ` : `
          <span class="controls-tree-expand" style="visibility: hidden;">▶</span>
        `}
        <span class="controls-tree-label">${isDisabled ? '🚫 ' : ''}${displayLabel}</span>
      </div>
  `;

    if (hasChildren)
    {
        html += `<div class="controls-tree-children ${isExpanded ? '' : 'collapsed'}">`;
        node.children.forEach(child =>
        {
            html += renderTreeNode(child, depth + 1);
        });
        html += '</div>';
    }

    html += '</div>';
    return html;
}

function cleanupLabel(label)
{
    // Remove @ui_ prefix and convert to readable format
    let clean = label.replace(/^@ui_/i, '');
    // Convert camelCase or PascalCase to spaces
    clean = clean.replace(/([A-Z])/g, ' $1').trim();
    // Convert underscores to spaces
    clean = clean.replace(/_/g, ' ');
    // Capitalize first letter
    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
    return clean;
}

function toggleTreeExpand(toggle)
{
    toggle.classList.toggle('expanded');
    const treeItem = toggle.closest('.controls-tree-item');
    const children = treeItem.querySelector('.controls-tree-children');
    if (children)
    {
        children.classList.toggle('collapsed');
    }
}

function selectTreeNode(path)
{
    // Find the node data first
    const node = findNodeByPath(controlsData[currentDeviceType], path);

    // Don't select disabled nodes
    if (node && node.disabled)
    {
        console.log('[CONTROLS-EDITOR] Cannot select disabled node:', node.name);
        return;
    }

    // Update selection UI
    document.querySelectorAll('.controls-tree-node').forEach(node =>
    {
        node.classList.toggle('selected', node.dataset.path === path);
    });

    selectedNode = node;

    // Debug logging
    console.log('[CONTROLS-EDITOR] Selected path:', path);
    console.log('[CONTROLS-EDITOR] Found node:', selectedNode);
    if (selectedNode)
    {
        console.log('[CONTROLS-EDITOR] Node sectionType:', selectedNode.sectionType);
    }

    // Render settings panel
    renderSettingsPanel(selectedNode);
}

function findNodeByPath(root, path)
{
    if (!root || !path) return null;

    console.log('[CONTROLS-EDITOR] findNodeByPath - searching for:', path, 'in root:', root.name);

    // Handle the case where path matches root directly
    if (root.path === path)
    {
        return root;
    }

    // Recursive search through children
    function searchChildren(node, targetPath)
    {
        if (!node.children) return null;

        for (const child of node.children)
        {
            if (child.path === targetPath)
            {
                return child;
            }
            const found = searchChildren(child, targetPath);
            if (found) return found;
        }
        return null;
    }

    return searchChildren(root, path);
}

/**
 * Find a node by its name (the last part of the path)
 * Used when loading control options from backend where we only have the option name
 */
function findNodeByName(root, name)
{
    if (!root || !name) return null;

    // Check if this node's name matches
    if (root.name === name)
    {
        return root;
    }

    // Recursive search through children
    if (root.children)
    {
        for (const child of root.children)
        {
            const found = findNodeByName(child, name);
            if (found) return found;
        }
    }

    return null;
}

// ============================================================================
// SETTINGS PANEL
// ============================================================================

function clearSettingsPanel()
{
    const panel = document.getElementById('controls-settings-content');
    if (!panel) return;

    panel.innerHTML = `
    <div class="controls-empty-state">
      <div class="empty-icon">🎛️</div>
      <h3>Select a Control Option</h3>
      <p>Choose an option from the tree on the left to view and edit its settings.</p>
    </div>
  `;

    updateSettingsHeader(null);
}

function updateSettingsHeader(node)
{
    const headerTitle = document.querySelector('.controls-settings-header h2');
    const headerPath = document.querySelector('.controls-settings-path');

    if (!node)
    {
        if (headerTitle) headerTitle.textContent = 'Settings';
        if (headerPath) headerPath.textContent = '';
        return;
    }

    const displayLabel = getDisplayLabel(node);

    if (headerTitle) headerTitle.textContent = displayLabel;
    if (headerPath) headerPath.textContent = node.path;
}

function renderSettingsPanel(node)
{
    const panel = document.getElementById('controls-settings-content');
    if (!panel || !node)
    {
        clearSettingsPanel();
        return;
    }

    updateSettingsHeader(node);

    // Only show settings for leaf nodes (nodes without children)
    // Container nodes just organize the hierarchy
    const isLeafNode = !node.children || node.children.length === 0;

    // Simplified logic: section type determines what controls to show
    // - 'inversion' section: show invert toggles (leaf nodes only)
    // - 'curves' section: DISABLED - sensitivity curves don't persist in Star Citizen
    const sectionType = node.sectionType || 'inversion';
    const isInversionSection = sectionType === 'inversion';
    const isCurvesSection = sectionType === 'curves';

    // Inversion: only leaf nodes in inversion section
    // Curves: DISABLED - not persisting properly in Star Citizen
    const showInvertSection = isLeafNode && isInversionSection;
    const showCurveSection = false; // Disabled: sensitivity curves don't persist

    console.log('[CONTROLS-EDITOR] renderSettingsPanel - node:', node.name, 'isLeaf:', isLeafNode, 'sectionType:', sectionType);

    // Check for curve in both node data and user settings (with inheritance)
    const nodeCurve = node.curve;
    const curveInfo = getUserSettingWithInheritance(node.path, 'curve', null);
    const userCurve = curveInfo.value;
    const hasCurvePoints = nodeCurve !== null || (userCurve !== null && userCurve.points && userCurve.points.length > 0);

    // Determine curve mode: 'exponent' (simple) or 'curve' (custom points)
    // Check with inheritance so children inherit parent's mode
    const curveModeInfo = getUserSettingWithInheritance(node.path, 'curveMode', hasCurvePoints ? 'curve' : 'exponent');
    const curveMode = curveModeInfo.value;

    let html = '';

    // Inversion Section (only for leaf nodes)
    if (showInvertSection)
    {
        const invertInfo = getUserSettingWithInheritance(node.path, 'invert', node.invert || false);
        const currentInvert = invertInfo.value;

        // Build inheritance notice for inversion
        let invertInheritanceNotice = '';
        if (invertInfo.inherited && invertInfo.inheritedFrom)
        {
            invertInheritanceNotice = `
              <div class="controls-inherited-notice inherited-value">
                <span class="notice-icon">📥</span>
                <span class="notice-text">Inherited from <strong>${formatInheritedFromLabel(invertInfo.inheritedFrom)}</strong></span>
                <button class="btn btn-sm btn-secondary clear-inheritance-btn" data-path="${node.path}" data-setting="invert" title="Set custom value for this option">
                  Override
                </button>
              </div>
            `;
        }

        html += `
      <div class="controls-setting-section">
        <h3>↕️ Inversion</h3>
        ${invertInheritanceNotice}
        <div class="controls-invert-toggle ${invertInfo.inherited ? 'inherited' : ''}">
          <div class="toggle-info">
            <span class="toggle-label">Invert Axis</span>
            <span class="toggle-description">Reverse the direction of this input</span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="invert-toggle" ${currentInvert ? 'checked' : ''} 
                   data-path="${node.path}" data-setting="invert">
            <span class="toggle-slider"></span>
          </label>
        </div>
        ${node.invertCvar ? `
          <div class="controls-inherited-notice">
            <span class="notice-icon">ℹ️</span>
            <span class="notice-text">This setting is linked to console variable: <strong>${node.invertCvar}</strong></span>
          </div>
        ` : ''}
      </div>
    `;
    }

    // Curve Section (only for joystick/gamepad leaf nodes)
    if (showCurveSection)
    {
        html += `
      <div class="controls-setting-section">
        <h3>📈 Response Curve</h3>
        ${renderCurveModeSelector(node, curveMode)}
        ${curveMode === 'exponent' ? renderExponentEditor(node) : renderCurveEditor(node)}
      </div>
    `;
    }

    // If nothing to show (container node)
    if (!showInvertSection && !showCurveSection)
    {
        html += `
      <div class="controls-inherited-notice">
        <span class="notice-icon">📁</span>
        <span class="notice-text">This is a category node. Select a child option to configure its settings.</span>
      </div>
    `;

        // Show children summary
        if (node.children && node.children.length > 0)
        {
            html += `
        <div class="controls-setting-section">
          <h3>📋 Contains ${node.children.length} option${node.children.length > 1 ? 's' : ''}</h3>
          <ul style="margin: 0; padding-left: 1.5rem; color: var(--text-secondary);">
            ${node.children.map(child =>
            {
                return `<li>${getDisplayLabel(child)}</li>`;
            }).join('')}
          </ul>
        </div>
      `;
        }
    }

    // Action buttons (only for leaf nodes with settings)
    if (showInvertSection || showCurveSection)
    {
        html += `
      <div class="controls-action-buttons">
        <button class="btn btn-secondary" id="reset-settings-btn">↩️ Reset to Default</button>
        <span style="flex: 1;"></span>
        <div class="controls-save-indicator ${hasUnsavedChanges ? 'unsaved' : ''}" id="save-indicator">
          ${hasUnsavedChanges ? '⚠️ Unsaved changes' : '✓ Saved'}
        </div>
      </div>
    `;
    }

    panel.innerHTML = html;

    // Attach event listeners
    attachSettingsEventListeners(node);

    // Render curve canvas if applicable (only for leaf nodes)
    // (we show a linear line as default if no curve is defined)
    // Use requestAnimationFrame to ensure the canvas container has proper dimensions
    if (showCurveSection)
    {
        requestAnimationFrame(() =>
        {
            renderCurveCanvas(node);
        });
    }
}

/**
 * Renders the mode selector toggle between Exponent and Custom Curve modes
 */
function renderCurveModeSelector(node, currentMode)
{
    return `
    <div class="controls-curve-mode-selector">
      <div class="mode-info">
        <span class="mode-label">Curve Type</span>
        <span class="mode-description">Choose between simple exponent or custom curve points</span>
      </div>
      <div class="mode-toggle-group">
        <button class="mode-toggle-btn ${currentMode === 'exponent' ? 'active' : ''}" 
                data-mode="exponent" id="mode-exponent-btn">
          📐 Exponent
        </button>
        <button class="mode-toggle-btn ${currentMode === 'curve' ? 'active' : ''}" 
                data-mode="curve" id="mode-curve-btn">
          📈 Custom Curve
        </button>
      </div>
    </div>
  `;
}

function renderExponentEditor(node)
{
    // Get exponent with inheritance info
    const exponentInfo = getUserSettingWithInheritance(node.path, 'exponent', node.exponent || 1.0);
    const currentExponent = exponentInfo.value || 1.0;

    // Build inheritance notice HTML
    let inheritanceNotice = '';
    if (exponentInfo.inherited && exponentInfo.inheritedFrom)
    {
        inheritanceNotice = `
          <div class="controls-inherited-notice inherited-value">
            <span class="notice-icon">📥</span>
            <span class="notice-text">Inherited from <strong>${formatInheritedFromLabel(exponentInfo.inheritedFrom)}</strong></span>
            <button class="btn btn-sm btn-secondary clear-inheritance-btn" data-path="${node.path}" data-setting="exponent" title="Set custom value for this option">
              Override
            </button>
          </div>
        `;
    }

    return `
    <div class="controls-exponent-editor">
      ${inheritanceNotice}
      <div class="controls-exponent-description">
        <p>Adjust how the input responds to your controller movement.</p>
        <ul>
          <li><strong>1.0</strong> = Linear (direct 1:1 response)</li>
          <li><strong>&lt; 1.0</strong> = More sensitive at the start, less at the end</li>
          <li><strong>&gt; 1.0</strong> = Less sensitive at the start, more at the end (precision mode)</li>
        </ul>
      </div>
      <div class="controls-exponent-setting ${exponentInfo.inherited ? 'inherited' : ''}">
        <label>Exponent:</label>
        <input type="range" id="exponent-slider" min="0.5" max="3.0" step="0.1" 
               value="${currentExponent}" data-path="${node.path}" data-setting="exponent">
        <span class="controls-exponent-value" id="exponent-value">${currentExponent.toFixed(1)}</span>
      </div>
      <div class="controls-exponent-presets">
        <span style="color: var(--text-secondary); font-size: 0.85rem; margin-right: 0.5rem;">Presets:</span>
        <button class="controls-exponent-preset-btn" data-exponent="1.0">Linear (1.0)</button>
        <button class="controls-exponent-preset-btn" data-exponent="1.5">Smooth (1.5)</button>
        <button class="controls-exponent-preset-btn" data-exponent="2.0">Precise (2.0)</button>
        <button class="controls-exponent-preset-btn" data-exponent="2.5">Very Precise (2.5)</button>
      </div>
      <div class="controls-curve-canvas-container">
        <canvas class="controls-curve-canvas" id="curve-canvas"></canvas>
      </div>
    </div>
  `;
}

/**
 * Format the inherited-from label for display
 */
function formatInheritedFromLabel(name)
{
    // Try to get a friendly label from our label map
    const labelKey = `@ui_CO${name}`;
    if (SC_LABEL_MAP && SC_LABEL_MAP[labelKey])
    {
        return SC_LABEL_MAP[labelKey];
    }
    // Otherwise clean up the name
    return cleanupLabel(name);
}

function renderCurveEditor(node)
{
    // Get curve with inheritance info
    const curveInfo = getUserSettingWithInheritance(node.path, 'curve', node.curve);
    let curve = curveInfo.value;

    // Build inheritance notice for curves
    let inheritanceNotice = '';
    if (curveInfo.inherited && curveInfo.inheritedFrom)
    {
        inheritanceNotice = `
          <div class="controls-inherited-notice inherited-value">
            <span class="notice-icon">📥</span>
            <span class="notice-text">Curve inherited from <strong>${formatInheritedFromLabel(curveInfo.inheritedFrom)}</strong></span>
            <button class="btn btn-sm btn-secondary clear-inheritance-btn" data-path="${node.path}" data-setting="curve" title="Set custom curve for this option">
              Override
            </button>
          </div>
        `;
    }

    // If no curve exists, create a default linear curve with start/end points
    if (!curve || !curve.points || curve.points.length === 0)
    {
        curve = {
            reset: false,
            points: [
                { in: 0, out: 0 },
                { in: 1, out: 1 }
            ]
        };
    }

    if (curve.reset)
    {
        return `
      <div class="controls-inherited-notice">
        <span class="notice-icon">↩️</span>
        <span class="notice-text">Curve is reset to linear. Click a preset below to define a custom curve.</span>
      </div>
      ${renderCurveEditorEmpty(node)}
    `;
    }

    return `
    <div class="controls-curve-editor">
      ${inheritanceNotice}
      <div class="controls-curve-canvas-container">
        <canvas class="controls-curve-canvas" id="curve-canvas"></canvas>
      </div>
      
      <div class="controls-curve-points">
        <div class="controls-curve-points-header">
          <h4>Curve Points</h4>
          <button class="btn btn-secondary btn-sm" id="add-curve-point-btn">+ Add Point</button>
        </div>
        <table class="controls-curve-table">
          <thead>
            <tr>
              <th>Input</th>
              <th>Output</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="curve-points-tbody">
            ${curve.points.map((point, idx) => `
              <tr data-index="${idx}">
                <td><input type="number" min="0" max="1" step="0.01" value="${point.in}" data-field="in"></td>
                <td><input type="number" min="0" max="1" step="0.01" value="${point.out}" data-field="out"></td>
                <td><button class="btn btn-danger btn-sm remove-point-btn" data-index="${idx}">✕</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      
      <div class="controls-curve-presets">
        <span style="color: var(--text-secondary); font-size: 0.85rem; margin-right: 0.5rem;">Presets:</span>
        <button class="controls-curve-preset-btn" data-preset="linear">Linear</button>
        <button class="controls-curve-preset-btn" data-preset="smooth">Smooth</button>
        <button class="controls-curve-preset-btn" data-preset="aggressive">Aggressive</button>
        <button class="controls-curve-preset-btn" data-preset="precise">Precise</button>
      </div>
    </div>
  `;
}

function renderCurveEditorEmpty(node)
{
    return `
    <div class="controls-curve-editor">
      <div class="controls-curve-canvas-container">
        <canvas class="controls-curve-canvas" id="curve-canvas"></canvas>
      </div>
      
      <div class="controls-inherited-notice" style="margin-top: 1rem;">
        <span class="notice-icon">ℹ️</span>
        <span class="notice-text">No custom curve defined. Click a preset below to get started.</span>
      </div>
      
      <div class="controls-curve-presets">
        <span style="color: var(--text-secondary); font-size: 0.85rem; margin-right: 0.5rem;">Add curve:</span>
        <button class="controls-curve-preset-btn" data-preset="linear">Linear</button>
        <button class="controls-curve-preset-btn" data-preset="smooth">Smooth</button>
        <button class="controls-curve-preset-btn" data-preset="aggressive">Aggressive</button>
        <button class="controls-curve-preset-btn" data-preset="precise">Precise</button>
      </div>
    </div>
  `;
}

// ============================================================================
// CURVE CANVAS RENDERING
// ============================================================================

function renderCurveCanvas(node)
{
    const canvas = document.getElementById('curve-canvas');
    if (!canvas)
    {
        console.warn('[CONTROLS-EDITOR] Canvas element not found');
        return;
    }

    const ctx = canvas.getContext('2d');
    const container = canvas.parentElement;

    // Set canvas size - use fallback values if container has no dimensions yet
    let containerWidth = container.clientWidth;
    let containerHeight = container.clientHeight;

    // If container has no dimensions, use reasonable defaults
    if (containerWidth === 0 || containerHeight === 0)
    {
        console.warn('[CONTROLS-EDITOR] Canvas container has zero dimensions, using defaults');
        containerWidth = containerWidth || 400;
        containerHeight = containerHeight || 200;
    }

    canvas.width = containerWidth;
    canvas.height = containerHeight;

    const width = canvas.width;
    const height = canvas.height;
    const padding = 40;

    // Clear canvas
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-darkest').trim() || '#000';
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;

    // Vertical grid lines
    for (let i = 0; i <= 10; i++)
    {
        const x = padding + (i / 10) * (width - padding * 2);
        ctx.beginPath();
        ctx.moveTo(x, padding);
        ctx.lineTo(x, height - padding);
        ctx.stroke();
    }

    // Horizontal grid lines
    for (let i = 0; i <= 10; i++)
    {
        const y = padding + (i / 10) * (height - padding * 2);
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
    }

    // Draw axes
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;

    // X axis
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();

    // Y axis
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(padding, padding);
    ctx.stroke();

    // Draw labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';

    // X axis labels
    for (let i = 0; i <= 10; i += 2)
    {
        const x = padding + (i / 10) * (width - padding * 2);
        ctx.fillText((i / 10).toFixed(1), x, height - padding + 15);
    }

    // Y axis labels
    ctx.textAlign = 'right';
    for (let i = 0; i <= 10; i += 2)
    {
        const y = height - padding - (i / 10) * (height - padding * 2);
        ctx.fillText((i / 10).toFixed(1), padding - 5, y + 4);
    }

    // Axis titles
    ctx.textAlign = 'center';
    ctx.fillText('Input', width / 2, height - 5);

    ctx.save();
    ctx.translate(12, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Output', 0, 0);
    ctx.restore();

    // Get curve data and mode
    const curveMode = getUserSetting(node.path, 'curveMode', 'exponent');
    const curve = getUserSetting(node.path, 'curve', node.curve);
    const exponent = getUserSetting(node.path, 'exponent', node.exponent) || 1.0;

    // Draw linear reference (dashed)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, padding);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw the response curve
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim() || '#10b981';
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 3;
    ctx.beginPath();

    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;

    for (let i = 0; i <= 100; i++)
    {
        const inputVal = i / 100;
        let outputVal = inputVal;

        if (curveMode === 'exponent')
        {
            // In exponent mode, only apply exponent
            outputVal = Math.pow(inputVal, exponent);
        }
        else
        {
            // In curve mode, apply curve points if present
            if (curve && curve.points && curve.points.length > 0 && !curve.reset)
            {
                outputVal = interpolateCurve(inputVal, curve.points);
            }
        }

        const x = padding + inputVal * graphWidth;
        const y = height - padding - outputVal * graphHeight;

        if (i === 0)
        {
            ctx.moveTo(x, y);
        } else
        {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();

    // Draw curve points as circles
    // Draw curve points as circles (only in curve mode)
    if (curveMode === 'curve' && curve && curve.points && curve.points.length > 0 && !curve.reset)
    {
        ctx.fillStyle = accentColor;
        curve.points.forEach(point =>
        {
            const x = padding + point.in * graphWidth;
            const y = height - padding - point.out * graphHeight;

            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.fill();

            // White border
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        });
    }
}

function interpolateCurve(input, points)
{
    if (!points || points.length === 0) return input;

    // Sort points by input value
    const sorted = [...points].sort((a, b) => a.in - b.in);

    // Find the two points to interpolate between
    let lower = { in: 0, out: 0 };
    let upper = { in: 1, out: 1 };

    for (let i = 0; i < sorted.length; i++)
    {
        if (sorted[i].in <= input)
        {
            lower = sorted[i];
        }
        if (sorted[i].in >= input)
        {
            upper = sorted[i];
            break;
        }
    }

    // Handle edge case where input is beyond defined points
    if (input <= sorted[0].in)
    {
        return sorted[0].out * (input / sorted[0].in);
    }
    if (input >= sorted[sorted.length - 1].in)
    {
        const lastPoint = sorted[sorted.length - 1];
        const remaining = input - lastPoint.in;
        const remainingRange = 1 - lastPoint.in;
        const outputRemaining = 1 - lastPoint.out;
        return lastPoint.out + (remaining / remainingRange) * outputRemaining;
    }

    // Linear interpolation between lower and upper
    if (lower.in === upper.in) return lower.out;

    const t = (input - lower.in) / (upper.in - lower.in);
    return lower.out + t * (upper.out - lower.out);
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function attachSettingsEventListeners(node)
{
    // Override inherited value buttons
    const overrideBtns = document.querySelectorAll('.clear-inheritance-btn');
    overrideBtns.forEach(btn =>
    {
        btn.addEventListener('click', (e) =>
        {
            const path = e.target.dataset.path;
            const setting = e.target.dataset.setting;

            // Get the current inherited value and set it as an explicit value for this node
            const inheritedInfo = getUserSettingWithInheritance(path, setting, null);
            if (inheritedInfo.value !== null)
            {
                setUserSetting(path, setting, inheritedInfo.value);
                markUnsaved();
                renderSettingsPanel(node);
            }
        });
    });

    // Invert toggle
    const invertToggle = document.getElementById('invert-toggle');
    if (invertToggle)
    {
        invertToggle.addEventListener('change', (e) =>
        {
            setUserSetting(node.path, 'invert', e.target.checked);
            markUnsaved();
        });
    }

    // Curve mode toggle buttons
    const modeExponentBtn = document.getElementById('mode-exponent-btn');
    const modeCurveBtn = document.getElementById('mode-curve-btn');

    if (modeExponentBtn)
    {
        modeExponentBtn.addEventListener('click', () =>
        {
            setUserSetting(node.path, 'curveMode', 'exponent');
            markUnsaved();
            renderSettingsPanel(node);
        });
    }

    if (modeCurveBtn)
    {
        modeCurveBtn.addEventListener('click', () =>
        {
            setUserSetting(node.path, 'curveMode', 'curve');
            markUnsaved();
            renderSettingsPanel(node);
        });
    }

    // Exponent slider
    const exponentSlider = document.getElementById('exponent-slider');
    const exponentValue = document.getElementById('exponent-value');
    if (exponentSlider && exponentValue)
    {
        exponentSlider.addEventListener('input', (e) =>
        {
            const val = parseFloat(e.target.value);
            exponentValue.textContent = val.toFixed(1);
            // Ensure curveMode is set to 'exponent' when using the exponent slider
            setUserSetting(node.path, 'curveMode', 'exponent');
            setUserSetting(node.path, 'exponent', val);

            markUnsaved();
            renderCurveCanvas(node);
        });
    }

    // Exponent preset buttons
    const exponentPresetBtns = document.querySelectorAll('.controls-exponent-preset-btn');
    exponentPresetBtns.forEach(btn =>
    {
        btn.addEventListener('click', () =>
        {
            const exponent = parseFloat(btn.dataset.exponent);
            // Ensure curveMode is set to 'exponent' when using preset buttons
            setUserSetting(node.path, 'curveMode', 'exponent');
            setUserSetting(node.path, 'exponent', exponent);

            markUnsaved();
            renderSettingsPanel(node);
        });
    });

    // Curve point inputs
    const curvePointInputs = document.querySelectorAll('#curve-points-tbody input');
    curvePointInputs.forEach(input =>
    {
        input.addEventListener('change', (e) =>
        {
            updateCurvePoint(node, e);
            markUnsaved();
            renderCurveCanvas(node);
        });
    });

    // Remove point buttons
    const removePointBtns = document.querySelectorAll('.remove-point-btn');
    removePointBtns.forEach(btn =>
    {
        btn.addEventListener('click', (e) =>
        {
            const index = parseInt(e.target.dataset.index);
            removeCurvePoint(node, index);
            markUnsaved();
            renderSettingsPanel(node);
        });
    });

    // Add point button
    const addPointBtn = document.getElementById('add-curve-point-btn');
    if (addPointBtn)
    {
        addPointBtn.addEventListener('click', () =>
        {
            addCurvePoint(node);
            markUnsaved();
            renderSettingsPanel(node);
        });
    }

    // Curve preset buttons
    const presetBtns = document.querySelectorAll('.controls-curve-preset-btn');
    console.log('[CONTROLS-EDITOR] Found', presetBtns.length, 'curve preset buttons');
    presetBtns.forEach(btn =>
    {
        btn.addEventListener('click', () =>
        {
            console.log('[CONTROLS-EDITOR] Curve preset button clicked:', btn.dataset.preset);
            applyCurvePreset(node, btn.dataset.preset);
            markUnsaved();
            renderSettingsPanel(node);
        });
    });

    // Reset button
    const resetBtn = document.getElementById('reset-settings-btn');
    if (resetBtn)
    {
        resetBtn.addEventListener('click', () =>
        {
            resetNodeSettings(node);
            renderSettingsPanel(node);
        });
    }
}

function updateCurvePoint(node, event)
{
    const row = event.target.closest('tr');
    const index = parseInt(row.dataset.index);
    const field = event.target.dataset.field;
    const value = parseFloat(event.target.value);

    let curve = getUserSetting(node.path, 'curve', node.curve);
    if (!curve || !curve.points)
    {
        curve = { reset: false, points: [] };
    }

    if (curve.points[index])
    {
        curve.points[index][field] = Math.max(0, Math.min(1, value));
    }

    // Ensure curveMode is set to 'curve' when modifying curve points
    setUserSetting(node.path, 'curveMode', 'curve');
    setUserSetting(node.path, 'curve', curve);
}

function removeCurvePoint(node, index)
{
    let curve = getUserSetting(node.path, 'curve', node.curve);
    if (curve && curve.points)
    {
        curve.points.splice(index, 1);
        // Ensure curveMode is set to 'curve' when modifying curve points
        setUserSetting(node.path, 'curveMode', 'curve');
        setUserSetting(node.path, 'curve', curve);
    }
}

function addCurvePoint(node)
{
    let curve = getUserSetting(node.path, 'curve', node.curve);
    if (!curve)
    {
        curve = { reset: false, points: [] };
    }

    // Find a gap to add a new point
    const existingInputs = curve.points.map(p => p.in).sort((a, b) => a - b);
    let newIn = 0.5;

    if (existingInputs.length > 0)
    {
        // Find the largest gap
        let maxGap = existingInputs[0];
        let gapStart = 0;

        for (let i = 0; i < existingInputs.length - 1; i++)
        {
            const gap = existingInputs[i + 1] - existingInputs[i];
            if (gap > maxGap)
            {
                maxGap = gap;
                gapStart = existingInputs[i];
            }
        }

        // Check gap at the end
        const endGap = 1 - existingInputs[existingInputs.length - 1];
        if (endGap > maxGap)
        {
            gapStart = existingInputs[existingInputs.length - 1];
            maxGap = endGap;
        }

        newIn = gapStart + maxGap / 2;
    }

    curve.points.push({ in: newIn, out: newIn });
    curve.points.sort((a, b) => a.in - b.in);

    // Ensure curveMode is set to 'curve' when adding curve points
    setUserSetting(node.path, 'curveMode', 'curve');
    setUserSetting(node.path, 'curve', curve);
}

function applyCurvePreset(node, presetName)
{
    const presets = {
        linear: { reset: false, points: [] },
        smooth: {
            reset: false,
            points: [
                { in: 0.2, out: 0.05 },
                { in: 0.4, out: 0.15 },
                { in: 0.6, out: 0.35 },
                { in: 0.8, out: 0.65 }
            ]
        },
        aggressive: {
            reset: false,
            points: [
                { in: 0.1, out: 0.015 },
                { in: 0.2, out: 0.02 },
                { in: 0.3, out: 0.04 },
                { in: 0.4, out: 0.06 },
                { in: 0.5, out: 0.08 },
                { in: 0.6, out: 0.15 },
                { in: 0.7, out: 0.26 },
                { in: 0.8, out: 0.38 },
                { in: 0.9, out: 0.58 }
            ]
        },
        precise: {
            reset: false,
            points: [
                { in: 0.1, out: 0.02 },
                { in: 0.3, out: 0.08 },
                { in: 0.5, out: 0.20 },
                { in: 0.7, out: 0.45 },
                { in: 0.9, out: 0.80 }
            ]
        }
    };

    const preset = presets[presetName];
    if (preset)
    {
        console.log('[CONTROLS-EDITOR] Applying preset:', presetName, 'to path:', node.path);
        console.log('[CONTROLS-EDITOR] Preset data:', JSON.stringify(preset));
        const curveData = JSON.parse(JSON.stringify(preset));
        // Set curveMode to 'curve' when applying a curve preset
        setUserSetting(node.path, 'curveMode', 'curve');
        setUserSetting(node.path, 'curve', curveData);

        console.log('[CONTROLS-EDITOR] User settings after apply:', JSON.stringify(userSettings[currentDeviceType]));
    }
    else
    {
        console.warn('[CONTROLS-EDITOR] Unknown preset:', presetName);
    }
}

function resetNodeSettings(node)
{
    // Remove user settings for this node
    const deviceSettings = userSettings[currentDeviceType];
    if (currentDeviceType === 'joystick')
    {
        if (deviceSettings[currentJoystickInstance])
        {
            delete deviceSettings[currentJoystickInstance][node.path];
        }
    } else
    {
        delete deviceSettings[node.path];
    }

    hasUnsavedChanges = false;
    updateSaveIndicator();
}

// ============================================================================
// USER SETTINGS MANAGEMENT
// ============================================================================

/**
 * Get a user setting for a path, checking direct setting and option name fallback.
 * Does NOT check parent inheritance - use getUserSettingWithInheritance for that.
 */
function getUserSetting(path, settingName, defaultValue)
{
    let settings;

    if (currentDeviceType === 'joystick')
    {
        settings = userSettings.joystick[currentJoystickInstance] || {};
    } else if (currentDeviceType === 'gamepad')
    {
        settings = userSettings.gamepad[currentGamepadInstance] || {};
    } else
    {
        settings = userSettings[currentDeviceType] || {};
    }

    // First, try the full path
    const pathSettings = settings[path];
    if (pathSettings && pathSettings[settingName] !== undefined)
    {
        return pathSettings[settingName];
    }

    // If not found, try just the option name (last segment of path)
    // This handles settings imported from actionmaps.xml which use option names only
    const optionName = path.split('.').pop();
    if (optionName !== path)
    {
        const optionSettings = settings[optionName];
        if (optionSettings && optionSettings[settingName] !== undefined)
        {
            return optionSettings[settingName];
        }
    }

    return defaultValue;
}

/**
 * Get a user setting with inheritance from parent nodes.
 * Returns an object with { value, inherited, inheritedFrom } to indicate source.
 * 
 * @param {string} path - Full path to the node (e.g., "Options.onfoot.Sensitivity.fps_view_pitch")
 * @param {string} settingName - The setting name (e.g., "exponent", "curveMode")
 * @param {*} defaultValue - Default value if nothing is set
 * @returns {{ value: *, inherited: boolean, inheritedFrom: string|null }}
 */
function getUserSettingWithInheritance(path, settingName, defaultValue)
{
    // First, check if this node has its own setting
    const directValue = getUserSetting(path, settingName, undefined);
    if (directValue !== undefined)
    {
        return { value: directValue, inherited: false, inheritedFrom: null };
    }

    // Check parent paths for inherited values
    const pathParts = path.split('.');

    // Walk up the tree, checking each parent level
    for (let i = pathParts.length - 1; i >= 1; i--)
    {
        const parentPath = pathParts.slice(0, i).join('.');
        const parentValue = getUserSetting(parentPath, settingName, undefined);

        if (parentValue !== undefined)
        {
            // Found an inherited value
            const parentName = pathParts[i - 1]; // Name of the parent node
            return { value: parentValue, inherited: true, inheritedFrom: parentName };
        }
    }

    // No inherited value found, return default
    return { value: defaultValue, inherited: false, inheritedFrom: null };
}

/**
 * Check if a node has its own explicit setting (not inherited)
 */
function hasOwnSetting(path, settingName)
{
    return getUserSetting(path, settingName, undefined) !== undefined;
}

function setUserSetting(path, settingName, value)
{
    if (currentDeviceType === 'joystick')
    {
        if (!userSettings.joystick[currentJoystickInstance])
        {
            userSettings.joystick[currentJoystickInstance] = {};
        }
        if (!userSettings.joystick[currentJoystickInstance][path])
        {
            userSettings.joystick[currentJoystickInstance][path] = {};
        }
        userSettings.joystick[currentJoystickInstance][path][settingName] = value;
    } else if (currentDeviceType === 'gamepad')
    {
        if (!userSettings.gamepad[currentGamepadInstance])
        {
            userSettings.gamepad[currentGamepadInstance] = {};
        }
        if (!userSettings.gamepad[currentGamepadInstance][path])
        {
            userSettings.gamepad[currentGamepadInstance][path] = {};
        }
        userSettings.gamepad[currentGamepadInstance][path][settingName] = value;
    } else
    {
        if (!userSettings[currentDeviceType][path])
        {
            userSettings[currentDeviceType][path] = {};
        }
        userSettings[currentDeviceType][path][settingName] = value;
    }

    // Mark as having unsaved changes (for save indicator)
    hasUnsavedChanges = true;
    if (window.markUnsavedChanges)
    {
        window.markUnsavedChanges();
    }

    // Sync to backend (debounced) so settings persist across refresh
    debouncedSyncToBackend();
}

/**
 * Propagate curve settings from a container node to all its children
 */
function propagateCurveToChildren(node, curve)
{
    if (!node.children || node.children.length === 0) return;

    // Deep clone the curve for each child
    const curveClone = JSON.parse(JSON.stringify(curve));

    function applyToDescendants(childNode)
    {
        // Apply curveMode and curve to this child
        setUserSetting(childNode.path, 'curveMode', 'curve');
        setUserSetting(childNode.path, 'curve', JSON.parse(JSON.stringify(curveClone)));

        // Recursively apply to grandchildren
        if (childNode.children)
        {
            childNode.children.forEach(grandchild => applyToDescendants(grandchild));
        }
    }

    node.children.forEach(child => applyToDescendants(child));

    console.log('[CONTROLS-EDITOR] Propagated curve to all children of:', node.name);
}

/**
 * Propagate exponent settings from a container node to all its children
 */
function propagateExponentToChildren(node, exponent)
{
    if (!node.children || node.children.length === 0) return;

    function applyToDescendants(childNode)
    {
        // Apply curveMode and exponent to this child
        setUserSetting(childNode.path, 'curveMode', 'exponent');
        setUserSetting(childNode.path, 'exponent', exponent);

        // Recursively apply to grandchildren
        if (childNode.children)
        {
            childNode.children.forEach(grandchild => applyToDescendants(grandchild));
        }
    }

    node.children.forEach(child => applyToDescendants(child));

    console.log('[CONTROLS-EDITOR] Propagated exponent to all children of:', node.name);
}

/**
 * Check if a node is a container (has children)
 */
function isContainerNode(node)
{
    return node.children && node.children.length > 0;
}

function markUnsaved()
{
    hasUnsavedChanges = true;
    updateSaveIndicator();
}

function updateSaveIndicator()
{
    const indicator = document.getElementById('save-indicator');
    if (indicator)
    {
        indicator.classList.toggle('unsaved', hasUnsavedChanges);
        indicator.innerHTML = hasUnsavedChanges ? '⚠️ Unsaved changes' : '✓ Saved';
    }
}

/**
 * Mark the controls settings as saved (called after successful save)
 */
window.markControlsSettingsSaved = function ()
{
    hasUnsavedChanges = false;
    updateSaveIndicator();
};

/**
 * Check if there are unsaved control settings
 */
window.hasUnsavedControlSettings = function ()
{
    return hasUnsavedChanges;
};

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

/**
 * Get the current user settings for export
 */
window.getControlSettings = function ()
{
    return userSettings;
};

/**
 * Generate XML options elements for saving to the keybindings file.
 * Returns an array of { deviceType, instance, xml } objects.
 * 
 * The XML format for Star Citizen control options:
 * - Simple invert: <option_name invert="1"/>
 * - Exponent only: <option_name exponent="1.5"/>
 * - Curve with points:
 *   <option_name exponent="1">
 *     <nonlinearity_curve>
 *       <point in="0" out="0"/>
 *       <point in="0.5" out="0.25"/>
 *       <point in="1" out="1"/>
 *     </nonlinearity_curve>
 *   </option_name>
 */
window.generateControlOptionsXml = function (deviceType, instance = 1)
{
    let settings;

    if (deviceType === 'joystick')
    {
        settings = userSettings.joystick[instance] || {};
    } else
    {
        settings = userSettings[deviceType] || {};
    }

    console.log(`[CONTROLS-EDITOR] generateControlOptionsXml for ${deviceType} instance ${instance}:`, settings);

    if (Object.keys(settings).length === 0)
    {
        console.log(`[CONTROLS-EDITOR] No settings for ${deviceType}`);
        return null;
    }

    const controlOptions = [];

    for (const [path, pathSettings] of Object.entries(settings))
    {
        // Skip internal UI state like 'curveMode' 
        // We only want actual game settings: invert, exponent, curve

        const optionName = path.split('.').pop(); // Get last part of path
        const curveMode = pathSettings.curveMode || 'exponent';

        const hasInvert = pathSettings.invert !== undefined;
        const hasExponent = curveMode === 'exponent' && pathSettings.exponent !== undefined && pathSettings.exponent !== 1.0;
        const hasCurve = curveMode === 'curve' && pathSettings.curve && pathSettings.curve.points && pathSettings.curve.points.length > 0;

        console.log(`[CONTROLS-EDITOR] Path: ${path}, optionName: ${optionName}, hasInvert: ${hasInvert}, invert value: ${pathSettings.invert}, hasExponent: ${hasExponent}, hasCurve: ${hasCurve}`);

        // Skip if no actual settings to save
        if (!hasInvert && !hasExponent && !hasCurve)
        {
            console.log(`[CONTROLS-EDITOR] Skipping ${path} - no settings to save`);
            continue;
        }

        controlOptions.push({
            name: optionName,
            invert: hasInvert ? pathSettings.invert : undefined,
            exponent: hasExponent ? pathSettings.exponent : (hasCurve ? 1 : undefined),
            curve: hasCurve ? pathSettings.curve : undefined
        });
    }

    console.log(`[CONTROLS-EDITOR] Generated ${controlOptions.length} control options for ${deviceType}:`, controlOptions);

    if (controlOptions.length === 0)
    {
        return null;
    }

    return controlOptions;
};

/**
 * Generate all control options for all device types.
 * Returns an object with device options ready to be merged into the keybindings.
 */
window.getAllControlOptions = function ()
{
    console.log('[CONTROLS-EDITOR] getAllControlOptions called, userSettings:', JSON.stringify(userSettings, null, 2));

    const allOptions = [];

    // Check keyboard settings
    const keyboardOptions = window.generateControlOptionsXml('keyboard', 1);
    if (keyboardOptions)
    {
        allOptions.push({
            deviceType: 'keyboard',
            instance: 1,
            options: keyboardOptions
        });
    }

    // Check gamepad settings
    const gamepadOptions = window.generateControlOptionsXml('gamepad', 1);
    if (gamepadOptions)
    {
        allOptions.push({
            deviceType: 'gamepad',
            instance: 1,
            options: gamepadOptions
        });
    }

    // Check joystick settings (instances 1-8)
    for (let i = 1; i <= 8; i++)
    {
        const joystickOptions = window.generateControlOptionsXml('joystick', i);
        if (joystickOptions)
        {
            allOptions.push({
                deviceType: 'joystick',
                instance: i,
                options: joystickOptions
            });
        }
    }

    return allOptions;
};

/**
 * Load control settings from parsed options data.
 * Called when loading a keybindings file that contains options.
 */
window.loadControlSettings = function (deviceOptions)
{
    if (!deviceOptions || !Array.isArray(deviceOptions))
    {
        return;
    }

    // Clear existing settings
    userSettings = {
        keyboard: {},
        gamepad: {},
        joystick: {}
    };

    for (const deviceOpt of deviceOptions)
    {
        const { device_type, instance, control_options } = deviceOpt;

        if (!control_options || control_options.length === 0)
        {
            continue;
        }

        for (const opt of control_options)
        {
            const optionName = opt.name; // The option name (e.g., 'fps_view_pitch')
            const settings = {};

            // Parse attributes - they come as an array of [key, value] tuples
            if (opt.attributes && Array.isArray(opt.attributes))
            {
                for (const attr of opt.attributes)
                {
                    // Handle both [key, value] arrays and {key, value} objects
                    const key = Array.isArray(attr) ? attr[0] : attr.key;
                    const value = Array.isArray(attr) ? attr[1] : attr.value;

                    if (key === 'invert')
                    {
                        settings.invert = value === '1';
                    }
                    else if (key === 'exponent')
                    {
                        settings.exponent = parseFloat(value);
                        // Only set curveMode to exponent if we don't have curve points
                        if (!opt.curve_points || opt.curve_points.length === 0)
                        {
                            settings.curveMode = 'exponent';
                        }
                    }
                }
            }

            // Parse curve points if present
            if (opt.curve_points && Array.isArray(opt.curve_points) && opt.curve_points.length > 0)
            {
                settings.curveMode = 'curve';
                settings.curve = {
                    points: opt.curve_points.map(pt => ({
                        in: parseFloat(pt.in_val),
                        out: parseFloat(pt.out_val)
                    }))
                };
            }

            // Find the full tree path for this option
            // The tree uses paths like "root.master.mouse_curves.inversion.fps.fps_view_pitch"
            // but the backend only stores the option name like "fps_view_pitch"
            let fullPath = optionName;
            const treeData = controlsData && controlsData[device_type];
            if (treeData)
            {
                const node = findNodeByName(treeData, optionName);
                if (node && node.path)
                {
                    fullPath = node.path;
                }
            }

            // Store the settings using the full path
            if (device_type === 'joystick')
            {
                const instanceNum = parseInt(instance) || 1;
                if (!userSettings.joystick[instanceNum])
                {
                    userSettings.joystick[instanceNum] = {};
                }
                userSettings.joystick[instanceNum][fullPath] = settings;
            }
            else
            {
                if (!userSettings[device_type])
                {
                    userSettings[device_type] = {};
                }
                userSettings[device_type][fullPath] = settings;
            }
        }
    }

    console.log('[CONTROLS-EDITOR] Loaded control settings:', userSettings);

    // Re-render the tree to reflect the loaded settings (checkboxes, etc.)
    renderTree();

    // If there's a selected node, re-render the settings panel too
    if (selectedNode)
    {
        renderSettingsPanel(selectedNode);
    }
};

// ============================================================================
// CONTROLS FILE SAVE/LOAD (New .sccontrols format)
// ============================================================================

/**
 * Get the user settings in a format suitable for saving to a .sccontrols file
 */
window.getControlsForSaving = function ()
{
    // Convert userSettings to the format expected by the backend
    const devices = {
        keyboard: null,
        gamepad: null,
        joystick: null
    };

    // Convert keyboard settings
    if (userSettings.keyboard && Object.keys(userSettings.keyboard).length > 0)
    {
        devices.keyboard = convertSettingsForSave(userSettings.keyboard);
    }

    // Convert gamepad settings
    if (userSettings.gamepad && Object.keys(userSettings.gamepad).length > 0)
    {
        devices.gamepad = {};
        for (const [instanceNum, instanceSettings] of Object.entries(userSettings.gamepad))
        {
            if (instanceSettings && Object.keys(instanceSettings).length > 0)
            {
                devices.gamepad[instanceNum] = convertSettingsForSave(instanceSettings);
            }
        }
        if (Object.keys(devices.gamepad).length === 0)
        {
            devices.gamepad = null;
        }
    }

    // Convert joystick settings
    if (userSettings.joystick && Object.keys(userSettings.joystick).length > 0)
    {
        devices.joystick = {};
        for (const [instanceNum, instanceSettings] of Object.entries(userSettings.joystick))
        {
            if (instanceSettings && Object.keys(instanceSettings).length > 0)
            {
                devices.joystick[instanceNum] = convertSettingsForSave(instanceSettings);
            }
        }
        if (Object.keys(devices.joystick).length === 0)
        {
            devices.joystick = null;
        }
    }

    return devices;
};

/**
 * Convert internal settings format to save format
 * Path-based keys are converted to option names only
 * NOTE: Only invert settings are saved - curve/exponent are disabled
 */
function convertSettingsForSave(settings)
{
    const result = {};
    for (const [path, pathSettings] of Object.entries(settings))
    {
        // Extract the option name from the path (last segment)
        const optionName = path.split('.').pop();

        // Only include invert settings - curves/exponent don't persist in Star Citizen
        const saveSettings = {};

        if (pathSettings.invert !== undefined)
        {
            saveSettings.invert = pathSettings.invert;
        }

        // NOTE: Curve mode, exponent, and curve data are intentionally NOT saved
        // These settings don't persist properly in Star Citizen
        {
            result[optionName] = saveSettings;
        }
    }
    return result;
}

/**
 * Load settings from a .sccontrols file into the controls editor
 */
window.loadControlsFromFile = function (loadedData)
{
    console.log('[CONTROLS-EDITOR] Loading controls from file:', loadedData);

    // Clear existing settings
    userSettings = {
        keyboard: {},
        gamepad: {},
        joystick: {}
    };

    // Load keyboard settings
    if (loadedData.devices && loadedData.devices.keyboard)
    {
        userSettings.keyboard = convertLoadedSettings(loadedData.devices.keyboard);
    }

    // Load gamepad settings
    if (loadedData.devices && loadedData.devices.gamepad)
    {
        for (const [instanceNum, instanceSettings] of Object.entries(loadedData.devices.gamepad))
        {
            userSettings.gamepad[instanceNum] = convertLoadedSettings(instanceSettings);
        }
    }

    // Load joystick settings
    if (loadedData.devices && loadedData.devices.joystick)
    {
        for (const [instanceNum, instanceSettings] of Object.entries(loadedData.devices.joystick))
        {
            userSettings.joystick[instanceNum] = convertLoadedSettings(instanceSettings);
        }
    }

    console.log('[CONTROLS-EDITOR] Loaded user settings:', userSettings);

    // Mark as having unsaved changes (since we loaded from external file)
    hasUnsavedChanges = false;
    updateSaveIndicator();

    // Re-render the tree and settings
    renderTree();
    if (selectedNode)
    {
        renderSettingsPanel(selectedNode);
    }
};

/**
 * Convert loaded settings format to internal format
 * Need to map option names back to full paths
 */
function convertLoadedSettings(loadedSettings)
{
    const result = {};

    for (const [optionName, settings] of Object.entries(loadedSettings))
    {
        // For now, use the option name as the path
        // The tree will match by option name when rendering
        // TODO: Could map to full paths using controlsData if needed

        const pathSettings = {};

        if (settings.invert !== undefined)
        {
            pathSettings.invert = settings.invert;
        }
        if (settings.curveMode !== undefined)
        {
            pathSettings.curveMode = settings.curveMode;
        }
        if (settings.exponent !== undefined)
        {
            pathSettings.exponent = settings.exponent;
        }
        if (settings.curve !== undefined)
        {
            pathSettings.curve = settings.curve;
        }

        if (Object.keys(pathSettings).length > 0)
        {
            result[optionName] = pathSettings;
        }
    }

    return result;
}

/**
 * Check if there are any control settings to save
 */
window.hasControlSettings = function ()
{
    const hasKeyboard = userSettings.keyboard && Object.keys(userSettings.keyboard).length > 0;
    const hasGamepad = userSettings.gamepad && Object.keys(userSettings.gamepad).length > 0;
    const hasJoystick = userSettings.joystick && Object.keys(userSettings.joystick).length > 0;
    return hasKeyboard || hasGamepad || hasJoystick;
};

/**
 * Clear all control settings
 */
window.clearControlSettings = function ()
{
    userSettings = {
        keyboard: {},
        gamepad: {},
        joystick: {}
    };
    hasUnsavedChanges = false;
    updateSaveIndicator();
    renderTree();
    clearSettingsPanel();
};

// Make initialization globally available
window.initializeControlsEditor = window.initializeControlsEditor;
