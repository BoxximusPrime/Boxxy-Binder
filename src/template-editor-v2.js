import { CustomDropdown } from './custom-dropdown.js';

const DEFAULT_TEMPLATE_V2 = {
    name: '',
    version: '2.0',
    pages: []
};

// NOTE: Axis profiles are now determined dynamically from HID descriptors
// No hardcoded fallback profiles - we rely 100% on actual hardware detection

const LOGICAL_AXIS_OPTIONS = ['x', 'y', 'z', 'rotx', 'roty', 'rotz', 'slider', 'slider2', 'hat'];
const RAW_AXIS_RANGE = Array.from({ length: 8 }, (_, index) => index);

const state = {
    template: cloneDeep(DEFAULT_TEMPLATE_V2),
    selectedPageId: null,
    modalEditingPageId: null,
    modalCustomMapping: {},
    modalImagePath: '',
    modalImageDataUrl: null,
    initialized: false,
    // Axis detection state
    isDetectingAxis: false,
    axisDetectionSessionId: null,
    axisDetectionIntervalId: null,
    lastAxisValues: {},
    lastAxisUpdateTime: {},
    axisBitDepths: new Map(), // Track bit depths per axis
    hidDevicePath: null,
    cachedDescriptor: null // Cached HID descriptor bytes for axis detection
};

const dom = {
    pagesList: null,
    pagesEmpty: null,
    addPageBtn: null,
    pageModal: null,
    pageModalTitle: null,
    pageNameInput: null,
    pagePrefixSelect: null,
    devicePrefixDropdown: null,
    pageSaveBtn: null,
    pageCancelBtn: null,
    pageDeleteBtn: null,
    customAxisModal: null,
    customAxisTable: null,
    customAxisSaveBtn: null,
    customAxisCancelBtn: null,
    customAxisResetBtn: null,
    startAxisDetectionBtn: null,
    stopAxisDetectionBtn: null,
    axisDetectionStatus: null,
    pageLoadImageBtn: null,
    pageClearImageBtn: null,
    pageImageInfo: null,
    pageMirrorSelect: null,
    pageMirrorDropdown: null,
    pageImageFileInput: null
};

const callbacks = {
    getTemplate: null,
    onPagesChanged: null,
    onPageSelected: null
};

function getInvoke()
{
    return window.__TAURI__?.core?.invoke;
}

function markTemplateDirty()
{
    if (typeof window.markTemplateAsChanged === 'function')
    {
        window.markTemplateAsChanged();
    }
}

function cloneDeep(value)
{
    return JSON.parse(JSON.stringify(value));
}

function generatePageId()
{
    if (window.crypto?.randomUUID)
    {
        return window.crypto.randomUUID();
    }
    return `page_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
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

    if (!template.pages || !Array.isArray(template.pages))
    {
        console.log('[Migration] No pages to migrate');
        return template;
    }

    let migrated = false;

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

    // Also check legacy leftStick/rightStick structures
    if (template.leftStick?.joystickNumber !== undefined)
    {
        template.leftStick.device_prefix = `js${template.leftStick.joystickNumber}`;
        delete template.leftStick.joystickNumber;
        migrated = true;
    }
    if (template.rightStick?.joystickNumber !== undefined)
    {
        template.rightStick.device_prefix = `js${template.rightStick.joystickNumber}`;
        delete template.rightStick.joystickNumber;
        migrated = true;
    }

    // Update version if migration occurred
    if (migrated)
    {
        template.version = '1.1';
        console.log('[Migration] Template migrated to v1.1');
    }

    return template;
}

function invertProfile(profile)
{
    const inverted = {};
    Object.entries(profile || {}).forEach(([logical, raw]) =>
    {
        if (raw !== undefined && raw !== null)
        {
            inverted[raw] = logical;
        }
    });
    return inverted;
}

function describeAxisMapping(page)
{
    if (!page) return 'No axis mapping configured';

    const entries = Object.entries(page.axis_mapping || {});
    if (!entries.length)
    {
        return 'Axis mapping not configured';
    }
    const summary = entries
        .slice(0, 4)
        .map(([raw, logical]) => `${raw}→${logical}`)
        .join(', ');
    const more = entries.length > 4 ? ` +${entries.length - 4} more` : '';
    return `Axis mapping: ${summary}${more}`;
}

function renderPageList()
{
    if (!dom.pagesList || !dom.pagesEmpty) return;
    const pages = state.template.pages;
    dom.pagesList.innerHTML = '';
    dom.pagesEmpty.style.display = pages.length ? 'none' : 'block';

    pages.forEach((page, index) =>
    {
        const card = document.createElement('div');
        card.className = `template-page-card ${page.id === state.selectedPageId ? 'active' : ''}`;
        card.dataset.pageId = page.id;
        card.dataset.pageIndex = index;
        card.innerHTML = `
            <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
                <div class="page-drag-handle" title="Drag to reorder">⋮⋮</div>
                <div class="page-card-content">
                    <span class="template-page-name">${page.name || 'Untitled Page'}</span>
                    <span class="template-page-device">${page.device_name || 'Device not selected'}</span>
                    <div class="template-page-meta">${describeAxisMapping(page)}</div>
                </div>
            </div>
            <div class="template-page-actions">
                <button type="button" class="btn btn-secondary btn-sm page-export-btn" title="Export this device">📤 Export</button>
                <button type="button" class="btn btn-secondary btn-sm page-edit-btn">Edit</button>
                <button type="button" class="btn btn-secondary btn-sm page-delete-btn">Delete</button>
            </div>
        `;

        // Add mouse-based drag handlers to the drag handle
        const handle = card.querySelector('.page-drag-handle');
        handle.addEventListener('mousedown', (e) => startPageDrag(e, card, page.id, index));

        dom.pagesList.appendChild(card);
    });

    // Also update the toolbar page selector
    updateToolbarPageSelector();
}

// Mouse-based drag and drop state
let dragState = {
    isDragging: false,
    draggedPageId: null,
    draggedIndex: null,
    draggedCard: null,
    placeholder: null,
    startY: 0,
    offsetY: 0
};

function startPageDrag(e, card, pageId, index)
{
    e.preventDefault();
    e.stopPropagation();

    dragState.isDragging = true;
    dragState.draggedPageId = pageId;
    dragState.draggedIndex = index;
    dragState.draggedCard = card;
    dragState.startY = e.clientY;

    // Get the card's position relative to the list
    const cardRect = card.getBoundingClientRect();
    dragState.offsetY = e.clientY - cardRect.top;

    // Add dragging class
    card.classList.add('dragging');

    // Create placeholder
    dragState.placeholder = document.createElement('div');
    dragState.placeholder.className = 'page-drag-placeholder';
    dragState.placeholder.style.height = cardRect.height + 'px';

    // Insert placeholder after the card
    card.parentNode.insertBefore(dragState.placeholder, card.nextSibling);

    // Make the card position absolute for dragging
    card.style.position = 'absolute';
    card.style.width = cardRect.width + 'px';
    card.style.zIndex = '1000';
    card.style.left = cardRect.left + 'px';
    card.style.top = cardRect.top + 'px';
    card.style.pointerEvents = 'none';

    // Move card to body so it can move freely
    document.body.appendChild(card);

    // Add global mouse listeners
    document.addEventListener('mousemove', handlePageDragMove);
    document.addEventListener('mouseup', handlePageDragEnd);

    console.log('[DragDrop] Started dragging page:', pageId);
}

function handlePageDragMove(e)
{
    if (!dragState.isDragging || !dragState.draggedCard) return;

    // Move the dragged card with the mouse
    const newTop = e.clientY - dragState.offsetY;
    dragState.draggedCard.style.top = newTop + 'px';

    // Find which card we're hovering over
    const cards = dom.pagesList.querySelectorAll('.template-page-card:not(.dragging)');
    let insertBefore = null;

    cards.forEach(card =>
    {
        const rect = card.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;

        // Clear previous highlights
        card.classList.remove('drag-over-top', 'drag-over-bottom');

        if (e.clientY < midpoint && !insertBefore)
        {
            insertBefore = card;
            card.classList.add('drag-over-top');
        } else if (e.clientY >= midpoint && e.clientY < rect.bottom)
        {
            card.classList.add('drag-over-bottom');
        }
    });

    // Move placeholder to new position
    if (dragState.placeholder)
    {
        if (insertBefore)
        {
            dom.pagesList.insertBefore(dragState.placeholder, insertBefore);
        } else
        {
            // Append to end if past all cards
            dom.pagesList.appendChild(dragState.placeholder);
        }
    }
}

function handlePageDragEnd(e)
{
    if (!dragState.isDragging) return;

    console.log('[DragDrop] Drag ended');

    // Remove global listeners
    document.removeEventListener('mousemove', handlePageDragMove);
    document.removeEventListener('mouseup', handlePageDragEnd);

    // Clear all highlights
    dom.pagesList.querySelectorAll('.template-page-card').forEach(card =>
    {
        card.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    // Find new index based on placeholder position
    const placeholderIndex = Array.from(dom.pagesList.children).indexOf(dragState.placeholder);

    // Remove placeholder
    if (dragState.placeholder && dragState.placeholder.parentNode)
    {
        dragState.placeholder.parentNode.removeChild(dragState.placeholder);
    }

    // Remove the floating card
    if (dragState.draggedCard && dragState.draggedCard.parentNode)
    {
        dragState.draggedCard.parentNode.removeChild(dragState.draggedCard);
    }

    // Calculate new index (account for the fact placeholder was in the list)
    let newIndex = placeholderIndex;
    if (dragState.draggedIndex < placeholderIndex)
    {
        newIndex = placeholderIndex - 1; // Adjust because we removed original first
    }

    // Only reorder if position actually changed
    if (newIndex !== dragState.draggedIndex && newIndex >= 0)
    {
        const pages = state.template.pages;
        const [movedPage] = pages.splice(dragState.draggedIndex, 1);

        // Adjust newIndex if needed
        if (dragState.draggedIndex < newIndex)
        {
            newIndex = Math.min(newIndex, pages.length);
        }

        pages.splice(newIndex, 0, movedPage);

        console.log(`[DragDrop] Moved page "${movedPage.name}" from index ${dragState.draggedIndex} to ${newIndex}`);

        // Mark as dirty and refresh UI
        markTemplateDirty();
        callbacks.onPagesChanged?.(state.template.pages);
    }

    // Always re-render to restore normal state
    renderPageList();

    // Reset drag state
    dragState = {
        isDragging: false,
        draggedPageId: null,
        draggedIndex: null,
        draggedCard: null,
        placeholder: null,
        startY: 0,
        offsetY: 0
    };
}

function updateToolbarPageSelector()
{
    const toolbarPageButtons = document.getElementById('toolbar-page-buttons');
    if (!toolbarPageButtons) return;

    const pages = state.template.pages;

    // Remove all page buttons (keep the label)
    const existingButtons = toolbarPageButtons.querySelectorAll('button');
    existingButtons.forEach(btn => btn.remove());

    if (pages.length === 0)
    {
        return;
    }

    // Create a button for each page
    pages.forEach(page =>
    {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `control-btn toolbar-page-btn ${page.id === state.selectedPageId ? 'active' : ''}`;
        button.textContent = page.name || 'Untitled Page';
        button.title = page.device_name || 'No device selected';
        button.dataset.pageId = page.id;

        button.addEventListener('click', () =>
        {
            selectPage(page.id);
        });

        toolbarPageButtons.appendChild(button);
    });
}

function selectPage(pageId)
{
    state.selectedPageId = pageId;
    callbacks.onPageSelected?.(pageId || null);
    renderPageList();
}

function openPageModal(pageId = null)
{
    if (!dom.pageModal) return;
    state.modalEditingPageId = pageId;
    state.modalCustomMapping = {};
    state.modalImagePath = '';
    state.modalImageDataUrl = null;

    // Populate prefix options dynamically based on settings
    populatePrefixOptions();

    if (pageId)
    {
        const page = state.template.pages.find(p => p.id === pageId);
        if (page)
        {
            dom.pageModalTitle.textContent = `Edit Device: ${page.name || 'Untitled Page'}`;
            dom.pageNameInput.value = page.name || '';

            // Set devicePrefix dropdown value
            if (dom.devicePrefixDropdown)
            {
                const prefix = page.devicePrefix || page.device_prefix || '';
                dom.devicePrefixDropdown.setValue(prefix);
            }

            state.modalCustomMapping = cloneDeep(page.axis_mapping || {});

            // Load image info
            state.modalImagePath = page.image_path || '';
            state.modalImageDataUrl = page.image_data_url || null;
            if (dom.pageImageInfo && page.image_path)
            {
                dom.pageImageInfo.textContent = `Image: ${page.image_path}`;
                if (dom.pageClearImageBtn) dom.pageClearImageBtn.style.display = 'inline-flex';
            }

            // Populate mirror dropdown and set value
            populateMirrorSelect(pageId);
            if (dom.pageMirrorDropdown)
            {
                dom.pageMirrorDropdown.setValue(page.mirror_from_page_id || '');
            }

            dom.pageDeleteBtn.style.display = 'inline-flex';
        }
    } else
    {
        dom.pageModalTitle.textContent = 'Add Page';
        dom.pageNameInput.value = '';

        // Reset devicePrefix dropdown to default
        if (dom.devicePrefixDropdown)
        {
            dom.devicePrefixDropdown.setValue('');
        }

        // Clear image info
        if (dom.pageImageInfo) dom.pageImageInfo.textContent = '';
        if (dom.pageClearImageBtn) dom.pageClearImageBtn.style.display = 'none';

        // Populate mirror dropdown for new page
        populateMirrorSelect(null);
        if (dom.pageMirrorDropdown) dom.pageMirrorDropdown.setValue('');

        dom.pageDeleteBtn.style.display = 'none';
    }

    // Add input listener to update modal title as user types page name
    dom.pageNameInput.removeEventListener('input', updatePageModalTitle);
    dom.pageNameInput.addEventListener('input', updatePageModalTitle);

    dom.pageModal.style.display = 'flex';
    dom.pageNameInput.focus();
}

/**
 * Populate the device prefix dropdown options dynamically based on max joystick/gamepad settings
 */
function populatePrefixOptions()
{
    if (!dom.pagePrefixSelect) return;

    // Use the global function from device-manager.js if available, otherwise use defaults
    const maxJs = window.getMaxJoysticks ? window.getMaxJoysticks() : 4;
    const maxGp = window.getMaxGamepads ? window.getMaxGamepads() : 4;

    let optionsHtml = '<option value="">Select a prefix</option>\n';

    for (let i = 1; i <= maxJs; i++)
    {
        optionsHtml += `<option value="js${i}">js${i}</option>\n`;
    }

    for (let i = 1; i <= maxGp; i++)
    {
        optionsHtml += `<option value="gp${i}">gp${i}</option>\n`;
    }

    dom.pagePrefixSelect.innerHTML = optionsHtml;

    // Reinitialize CustomDropdown if it exists
    if (dom.devicePrefixDropdown)
    {
        dom.devicePrefixDropdown.destroy();
    }
    dom.devicePrefixDropdown = new CustomDropdown(dom.pagePrefixSelect, {
        onChange: (item) =>
        {
            console.log('[DevicePrefix] Changed to:', item.value);
        }
    });
}

function updatePageModalTitle()
{
    const pageName = dom.pageNameInput.value.trim() || 'Untitled Page';
    if (state.modalEditingPageId)
    {
        dom.pageModalTitle.textContent = `Edit Page: ${pageName}`;
    }
}

function closePageModal()
{
    if (!dom.pageModal) return;
    dom.pageModal.style.display = 'none';
    state.modalEditingPageId = null;
    state.modalCustomMapping = {};
}

function savePageFromModal()
{
    const name = dom.pageNameInput.value.trim() || 'Untitled Page';

    // Get devicePrefix from CustomDropdown
    const devicePrefix = dom.devicePrefixDropdown ? dom.devicePrefixDropdown.getValue() : '';

    // Validate that a prefix has been selected
    if (!devicePrefix || devicePrefix.trim() === '')
    {
        const showAlert = window.showAlert || alert;
        showAlert('Please select a device prefix before saving.', 'Device Prefix Required');
        return;
    }

    // Always use custom mapping (from HID descriptor or user configuration)
    const axisMapping = cloneDeep(state.modalCustomMapping || {});

    // Get image and mirror settings
    const imagePath = state.modalImagePath || '';
    const imageDataUrl = state.modalImageDataUrl || null;
    const mirrorFromPageId = dom.pageMirrorDropdown ? dom.pageMirrorDropdown.getValue() : '';

    if (state.modalEditingPageId)
    {
        const page = state.template.pages.find(p => p.id === state.modalEditingPageId);
        if (page)
        {
            // Check if prefix changed
            const oldPrefix = page.device_prefix || page.devicePrefix || '';
            const newPrefix = devicePrefix || '';

            page.name = name;
            page.device_prefix = devicePrefix; // Use snake_case to match JSON format
            page.axis_mapping = axisMapping;
            page.image_path = imagePath;
            page.image_data_url = imageDataUrl;
            page.mirror_from_page_id = mirrorFromPageId;

            // If prefix changed, update all existing button inputs
            // Note: With new format, buttons no longer have prefixes in their input names
            // The devicePrefix is prepended when looking up bindings
            // So we need to strip any existing prefixes from buttons
            if (page.buttons && page.buttons.length > 0)
            {
                console.log(`[TemplateEditorV2] Updating ${page.buttons.length} buttons to remove prefixes...`);

                page.buttons.forEach(button =>
                {
                    if (button.inputs)
                    {
                        Object.keys(button.inputs).forEach(key =>
                        {
                            const val = button.inputs[key];
                            if (typeof val === 'string')
                            {
                                // Remove any device prefix (js1_, js2_, gp1_, etc.)
                                const newVal = val.replace(/^(js|gp)\d+_/, '');
                                if (newVal !== val)
                                {
                                    button.inputs[key] = newVal;
                                    console.log(`[TemplateEditorV2]   Updated "${val}" -> "${newVal}"`);
                                }
                            }
                        });
                    }
                });
            }

            // Refresh the canvas if this is the currently displayed page
            // Check both state.selectedPageId and window.currentPageId for compatibility
            const isCurrentPage = state.selectedPageId === state.modalEditingPageId ||
                window.currentPageId === state.modalEditingPageId;

            if (isCurrentPage)
            {
                // Load the updated page image directly
                if (page.mirror_from_page_id)
                {
                    const mirrorPage = state.template.pages.find(p => p.id === page.mirror_from_page_id);
                    if (mirrorPage && mirrorPage.image_data_url)
                    {
                        const img = new Image();
                        img.onload = () =>
                        {
                            if (typeof window.setLoadedImage === 'function')
                            {
                                window.setLoadedImage(img);
                            }
                            requestAnimationFrame(() =>
                            {
                                if (typeof window.redraw === 'function')
                                {
                                    window.redraw();
                                }
                            });
                        };
                        img.onerror = () => console.error('Failed to load mirror image');
                        img.src = mirrorPage.image_data_url;
                    }
                }
                else if (page.image_data_url)
                {
                    const img = new Image();
                    img.onload = () =>
                    {
                        if (typeof window.setLoadedImage === 'function')
                        {
                            window.setLoadedImage(img);
                        }
                        requestAnimationFrame(() =>
                        {
                            if (typeof window.redraw === 'function')
                            {
                                window.redraw();
                            }
                        });
                    };
                    img.onerror = () => console.error('Failed to load own image');
                    img.src = page.image_data_url;
                }
                else
                {
                    if (typeof window.setLoadedImage === 'function')
                    {
                        window.setLoadedImage(null);
                    }
                    requestAnimationFrame(() =>
                    {
                        if (typeof window.redraw === 'function')
                        {
                            window.redraw();
                        }
                    });
                }
            }
        }
        else
        {
            console.error('[savePageFromModal] Page not found:', state.modalEditingPageId);
        }
    } else
    {
        state.template.pages.push({
            id: generatePageId(),
            name,
            device_prefix: devicePrefix, // Use snake_case to match JSON format
            axis_mapping: axisMapping,
            image_path: imagePath,
            image_data_url: imageDataUrl,
            mirror_from_page_id: mirrorFromPageId,
            buttons: [],
            button_positions: []
        });
    }

    if (!state.selectedPageId && state.template.pages.length)
    {
        state.selectedPageId = state.template.pages[0].id;
    }

    renderPageList();
    markTemplateDirty();
    callbacks.onPagesChanged?.(state.template.pages);
    closePageModal();
}

function deletePage(pageId)
{
    const pages = state.template.pages.filter(page => page.id !== pageId);
    if (pages.length === state.template.pages.length) return;
    state.template.pages = pages;
    if (state.selectedPageId === pageId)
    {
        state.selectedPageId = state.template.pages[0]?.id || null;
    }
    renderPageList();
    markTemplateDirty();
    callbacks.onPagesChanged?.(state.template.pages);
}

async function deletePageWithConfirmation(pageId)
{
    const page = state.template.pages.find(p => p.id === pageId);
    if (!page) return;

    const confirmed = await window.showConfirmation(
        `Are you sure you want to delete the device "${page.name || 'Untitled Device'}"? This action cannot be undone.`,
        '🗑️ Delete Device',
        'Delete',
        'Cancel',
        'btn-danger'
    );

    if (confirmed)
    {
        deletePage(pageId);
    }
}

function handlePagesListClick(event)
{
    const card = event.target.closest('.template-page-card');
    if (!card) return;
    const pageId = card.dataset.pageId;
    if (!pageId) return;

    if (event.target.classList.contains('page-export-btn'))
    {
        event.stopPropagation();
        exportDevice(pageId);
        return;
    }
    if (event.target.classList.contains('page-edit-btn'))
    {
        event.stopPropagation();
        openPageModal(pageId);
        return;
    }
    if (event.target.classList.contains('page-delete-btn'))
    {
        event.stopPropagation();
        deletePageWithConfirmation(pageId);
        return;
    }
    selectPage(pageId);
}

function openCustomAxisModal()
{
    if (!dom.customAxisModal || !dom.customAxisTable) return;

    // Store the original mapping so we can detect changes
    state.originalCustomMapping = cloneDeep(state.modalCustomMapping);

    renderCustomAxisTable();
    dom.customAxisModal.style.display = 'flex';
}

function closeCustomAxisModal()
{
    if (!dom.customAxisModal) return;
    stopAxisDetection();
    dom.customAxisModal.style.display = 'none';
}

function renderCustomAxisTable()
{
    const mapping = state.modalCustomMapping || {};

    const rows = RAW_AXIS_RANGE.map(rawIndex =>
    {
        const isAssigned = mapping[rawIndex] && mapping[rawIndex] !== '';

        const axisLabel = `Raw Axis ${rawIndex}`;

        const options = LOGICAL_AXIS_OPTIONS.map(axis =>
            `<option value="${axis}" ${mapping[rawIndex] === axis ? 'selected' : ''}>${axis}</option>`
        ).join('');

        return `<div class="custom-axis-row ${isAssigned ? 'axis-assigned' : ''}" data-raw-index="${rawIndex}">
            <label>${axisLabel}</label>
            <select data-raw-index="${rawIndex}">
                <option value="">— Unassigned —</option>
                ${options}
            </select>
        </div>`;
    });

    dom.customAxisTable.innerHTML = rows.join('');

    // Add change listeners to update green highlight when user changes values
    dom.customAxisTable.querySelectorAll('select').forEach(select =>
    {
        select.addEventListener('change', () =>
        {
            const row = select.closest('.custom-axis-row');
            if (select.value && select.value !== '')
            {
                row.classList.add('axis-assigned');
            } else
            {
                row.classList.remove('axis-assigned');
            }
        });
    });
}

function saveCustomAxisMapping()
{
    const mapping = {};
    dom.customAxisTable.querySelectorAll('select').forEach(select =>
    {
        const rawIndex = Number(select.dataset.rawIndex);
        if (select.value)
        {
            mapping[rawIndex] = select.value;
        }
    });

    state.modalCustomMapping = mapping;
    closeCustomAxisModal();
}

async function resetCustomAxisMapping()
{
    // Clear current mapping
    state.modalCustomMapping = {};

    renderCustomAxisTable();
    updateAxisSummary();
}

function updateAxisSummary()
{
    if (!dom.axisSummary) return;
    // Check if custom mapping is configured
    const entries = Object.entries(state.modalCustomMapping || {});
    if (!entries.length)
    {
        dom.axisSummary.textContent = 'Using HID descriptor axis detection.';
        return;
    }
    const summary = entries.map(([raw, logical]) => `${raw}→${logical}`).join(', ');
    dom.axisSummary.textContent = `Custom mapping: ${summary}`;
}

function populateMirrorSelect(currentPageId)
{
    if (!dom.pageMirrorSelect) return;

    const options = ['<option value="">No Mirror (Use Own Image)</option>'];

    // Add all pages except the current one
    state.template.pages.forEach(page =>
    {
        if (page.id !== currentPageId)
        {
            options.push(`<option value="${page.id}">${page.name || 'Untitled Page'}</option>`);
        }
    });

    dom.pageMirrorSelect.innerHTML = options.join('');

    // Reinitialize the CustomDropdown to reflect the new options
    if (dom.pageMirrorDropdown)
    {
        dom.pageMirrorDropdown.populateFromSelect();
    }
}

function handlePageImageLoad()
{
    if (!dom.pageImageFileInput)
    {
        // Create hidden file input if it doesn't exist
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.display = 'none';
        input.addEventListener('change', onPageImageFileSelected);
        document.body.appendChild(input);
        dom.pageImageFileInput = input;
    }
    dom.pageImageFileInput.click();
}

function onPageImageFileSelected(e)
{
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) =>
    {
        state.modalImagePath = file.name;
        state.modalImageDataUrl = event.target.result;

        if (dom.pageImageInfo)
        {
            dom.pageImageInfo.textContent = `Image: ${file.name}`;
        }
        if (dom.pageClearImageBtn)
        {
            dom.pageClearImageBtn.style.display = 'inline-flex';
        }

        // Create an image object and refresh canvas
        const img = new Image();
        img.onload = () =>
        {
            // Resize image to max 1024px width
            resizeImage(img, 1024, (resizedImg) =>
            {
                // Update the stored data URL with the resized version
                state.modalImageDataUrl = resizedImg.src;

                window.loadedImage = resizedImg;
                if (typeof window.redraw === 'function')
                {
                    window.redraw();
                }
            });
        };
        img.src = state.modalImageDataUrl;
    };
    reader.readAsDataURL(file);

    // Clear the input so the same file can be loaded again
    e.target.value = '';
}

function clearPageImage()
{
    state.modalImagePath = '';
    state.modalImageDataUrl = null;

    if (dom.pageImageInfo)
    {
        dom.pageImageInfo.textContent = '';
    }
    if (dom.pageClearImageBtn)
    {
        dom.pageClearImageBtn.style.display = 'none';
    }
}

// Helper function to resize image to max width of 1024px while maintaining aspect ratio
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

// Device detection functionality
// Axis detection functionality
async function startAxisDetection()
{
    const invoke = getInvoke();
    if (!invoke)
    {
        dom.axisDetectionStatus.textContent = 'Tauri API not available';
        return;
    }

    state.isDetectingAxis = true;
    state.lastAxisValues = {};
    state.hidDevicePath = null;
    state.cachedDescriptor = null;
    state.isFirstAxisPoll = true; // Track first poll to initialize baselines

    dom.startAxisDetectionBtn.style.display = 'none';
    dom.stopAxisDetectionBtn.style.display = 'inline-flex';
    dom.axisDetectionStatus.textContent = '🎯 Detecting... Move any axis on your device!';
    dom.axisDetectionStatus.style.color = '#ffc107';

    // Try to get HID path for this device to use HID polling (more accurate and consistent with debugger)
    try
    {
        if (deviceName)
        {
            console.log('[Axis Detection] Attempting to get HID path for:', deviceName);
            state.hidDevicePath = await invoke('get_hid_device_path', { deviceName });

            // Fallback: try to find by listing HID devices if direct lookup failed
            if (!state.hidDevicePath)
            {
                console.log('[Axis Detection] Direct lookup failed, listing all HID devices...');
                try
                {
                    const hidDevices = await invoke('list_hid_devices');
                    // Try to find a match - check if names contain each other
                    const match = hidDevices.find(d =>
                    {
                        const p = (d.product || '').toLowerCase();
                        const n = deviceName.toLowerCase();
                        return p && (p.includes(n) || n.includes(p));
                    });

                    if (match)
                    {
                        state.hidDevicePath = match.path;
                        console.log('[Axis Detection] Found matching HID device via list:', match.product, match.path);
                    }
                } catch (err)
                {
                    console.warn('[Axis Detection] Failed to list HID devices:', err);
                }
            }

            console.log('[Axis Detection] Got HID path:', state.hidDevicePath);
            if (state.hidDevicePath)
            {
                console.log('[Axis Detection] ✓ Using HID polling with path:', state.hidDevicePath);

                // Cache the descriptor for efficient parsing
                try
                {
                    state.cachedDescriptor = await invoke('get_hid_descriptor_bytes', { devicePath: state.hidDevicePath });
                    console.log(`[Axis Detection] Cached descriptor (${state.cachedDescriptor.length} bytes)`);
                } catch (e)
                {
                    console.warn('[Axis Detection] Could not cache descriptor:', e);
                }

                pollHidAxisMovement();
                return;
            } else
            {
                console.log('[Axis Detection] ✗ No HID path returned, using DirectInput');
            }
        } else
        {
            console.log('[Axis Detection] ✗ No device name available');
        }
    } catch (e)
    {
        console.warn('[Axis Detection] Failed to get HID path, falling back to DirectInput:', e);
    }

    console.log('[Axis Detection] Using DirectInput polling');

    // Poll for axis movement using recursive async loop instead of setInterval
    // This ensures we don't stack up calls if backend is slow
    async function pollAxisMovement()
    {
        if (!state.isDetectingAxis) return;

        try
        {
            // Pass short timeout so the call returns quickly
            const result = await invoke('detect_axis_movement', {
                deviceUuid,
                timeoutMillis: 50
            });

            if (result && result.axis_id !== undefined && result.value !== undefined)
            {
                const axisId = result.axis_id;
                const value = result.value;

                // Track last update time for each axis to prevent flooding
                if (!state.lastAxisUpdateTime) state.lastAxisUpdateTime = {};
                const now = Date.now();
                const lastUpdateTime = state.lastAxisUpdateTime[axisId] || 0;

                // Only update if axis moved significantly OR enough time has passed
                const lastValue = state.lastAxisValues[axisId] || 0;
                const delta = Math.abs(value - lastValue);
                const timeSinceLastUpdate = now - lastUpdateTime;

                // Require significant change (>0.15) or 500ms cooldown between updates
                if (delta > 0.15 || timeSinceLastUpdate > 500)
                {
                    state.lastAxisValues[axisId] = value;
                    state.lastAxisUpdateTime[axisId] = now;
                    highlightAxis(axisId, value);
                }
            }
        }
        catch (error)
        {
            console.error('Axis detection error:', error);
        }

        // Schedule next poll after this one completes (prevents stacking)
        if (state.isDetectingAxis)
        {
            setTimeout(pollAxisMovement, 10); // Small delay between polls
        }
    }

    // Start the polling loop
    pollAxisMovement();
}

async function pollHidAxisMovement()
{
    if (!state.isDetectingAxis || !state.hidDevicePath)
    {
        return;
    }

    const invoke = getInvoke();

    try
    {
        // Read raw HID report
        const report = await invoke('read_hid_device_report', {
            devicePath: state.hidDevicePath,
            timeoutMs: 50
        });

        if (report && report.length > 0)
        {
            // Parse the report using cached descriptor if available
            const axisReport = state.cachedDescriptor
                ? await invoke('parse_hid_report_with_descriptor', {
                    report: report,
                    descriptor: state.cachedDescriptor
                })
                : await invoke('parse_hid_report', {
                    report: report,
                    devicePath: state.hidDevicePath
                });

            if (axisReport && axisReport.axis_values)
            {
                // Build a mapping from usage IDs to raw indices (0-based sequential)
                // This matches the custom axis table where rows are 0-7
                const usageIds = Object.keys(axisReport.axis_values).map(k => parseInt(k)).sort((a, b) => a - b);
                const usageToRawIndex = {};
                usageIds.forEach((usageId, index) =>
                {
                    usageToRawIndex[usageId] = index;
                });

                // Process each axis
                for (const [axisIdStr, value] of Object.entries(axisReport.axis_values))
                {
                    const usageId = parseInt(axisIdStr);
                    const rawIndex = usageToRawIndex[usageId];

                    // Get bit depth and range for this axis
                    const bitDepth = axisReport.axis_bit_depths ? axisReport.axis_bit_depths[axisIdStr] : 16;
                    const axisRange = axisReport.axis_ranges ? axisReport.axis_ranges[axisIdStr] : null;

                    // Track max bit depth
                    if (bitDepth)
                    {
                        const currentMax = state.axisBitDepths.get(rawIndex) || 0;
                        if (bitDepth > currentMax)
                        {
                            state.axisBitDepths.set(rawIndex, bitDepth);
                        }
                    }

                    // Calculate the actual max value from logical range if available
                    const maxValue = axisRange ? axisRange[1] : (1 << bitDepth) - 1; // Use logical_max or calculate from bit depth

                    // On first poll, just initialize the baseline values without triggering detection
                    if (state.isFirstAxisPoll)
                    {
                        state.lastAxisValues[rawIndex] = value;
                        continue; // Skip detection on first poll
                    }

                    // Use percentage-based threshold: 2% of the axis range
                    // This adapts to different bit depths automatically
                    // For 12-bit (4095): threshold = 82, for 11-bit (2047): threshold = 41
                    // For 10-bit (1023): threshold = 20, for 16-bit (65535): threshold = 1311
                    const thresholdPercent = 0.02; // 2%
                    const threshold = Math.max(2, Math.round(maxValue * thresholdPercent));

                    // Check for change
                    const lastValue = state.lastAxisValues[rawIndex];
                    if (lastValue === undefined)
                    {
                        // If we somehow don't have a baseline, set it now
                        state.lastAxisValues[rawIndex] = value;
                        continue;
                    }

                    const changed = Math.abs(value - lastValue) > threshold;

                    if (changed)
                    {
                        state.lastAxisValues[rawIndex] = value;
                        // Pass rawIndex (0-based), value, bit depth, and max value
                        highlightAxis(rawIndex, value, bitDepth, maxValue);
                    }
                }

                // After first poll, clear the flag
                if (state.isFirstAxisPoll)
                {
                    state.isFirstAxisPoll = false;
                    console.log('[Axis Detection] Baseline values initialized, ready to detect movement');
                }
            }
        }
    }
    catch (error)
    {
        // Ignore timeouts
        if (!error.toString().includes('timeout'))
        {
            console.error('HID Axis detection error:', error);
        }
    }

    // Schedule next poll
    if (state.isDetectingAxis)
    {
        setTimeout(pollHidAxisMovement, 10);
    }
}

function stopAxisDetection()
{
    state.isDetectingAxis = false;
    // No need to clear interval anymore - the recursive loop will stop on its own

    dom.startAxisDetectionBtn.style.display = 'inline-flex';
    dom.stopAxisDetectionBtn.style.display = 'none';
    dom.axisDetectionStatus.textContent = 'Detection stopped. Click "Start Detection" to resume.';
    dom.axisDetectionStatus.style.color = '';

    // Clear highlighting
    document.querySelectorAll('.custom-axis-row').forEach(row =>
    {
        row.classList.remove('detecting');
        const valueDisplay = row.querySelector('.axis-value-display');
        if (valueDisplay)
        {
            valueDisplay.textContent = '';
            valueDisplay.classList.remove('active');
        }
    });
}

function highlightAxis(rawIndex, value, bitDepth = 16, maxValue = 65535)
{
    // rawIndex is 0-based (0-7) matching the custom-axis-row data-raw-index
    // Find the row for this axis
    const row = document.querySelector(`.custom-axis-row[data-raw-index="${rawIndex}"]`);
    if (!row) return;

    // Highlight the row with auto-fade after 2 seconds
    row.classList.add('detecting');

    // Clear any existing timeout for this row
    if (row._highlightTimeout)
    {
        clearTimeout(row._highlightTimeout);
    }

    row._highlightTimeout = setTimeout(() =>
    {
        row.classList.remove('detecting');
        const valueDisplay = row.querySelector('.axis-value-display');
        if (valueDisplay)
        {
            valueDisplay.classList.remove('active');
        }
    }, 2000);

    // Update value display
    let valueDisplay = row.querySelector('.axis-value-display');
    if (!valueDisplay)
    {
        valueDisplay = document.createElement('div');
        valueDisplay.className = 'axis-value-display';
        row.appendChild(valueDisplay);
    }

    // Format value based on type
    let displayText;
    if (typeof value === 'number')
    {
        if (Number.isInteger(value))
        {
            // Integer (HID raw value)
            const pct = Math.round((value / maxValue) * 100);
            displayText = `Value: ${value} (${pct}%, ${bitDepth}-bit)`;
        } else
        {
            // Float (DirectInput value -1.0 to 1.0)
            displayText = `Value: ${value.toFixed(3)}`;
        }
    } else
    {
        displayText = `Value: ${value}`;
    }

    valueDisplay.textContent = displayText;
    valueDisplay.classList.add('active');

    // Update status - show raw index + 1 for user-friendly display (Axis 1-8)
    dom.axisDetectionStatus.textContent = `🎯 Detected movement on Raw Axis ${rawIndex} (${bitDepth}-bit)! Assign it using the dropdown.`;
}


export function getTemplateV2State()
{
    return state;
}

export async function initializeTemplatePagesUI(options = {})
{
    if (options && typeof options === 'object')
    {
        if (options.getTemplate) callbacks.getTemplate = options.getTemplate;
        if (options.onPagesChanged) callbacks.onPagesChanged = options.onPagesChanged;
        if (options.onPageSelected) callbacks.onPageSelected = options.onPageSelected;
    }

    if (state.initialized)
    {
        refreshTemplatePagesUI(options?.template || null);
        return;
    }

    dom.pagesList = document.getElementById('template-pages-list');
    dom.pagesEmpty = document.getElementById('template-pages-empty');
    dom.addPageBtn = document.getElementById('add-template-page-btn');
    dom.pageModal = document.getElementById('template-page-modal');
    dom.pageModalTitle = document.getElementById('template-page-modal-title');
    dom.pageNameInput = document.getElementById('template-page-name');
    dom.pagePrefixSelect = document.getElementById('template-page-prefix');

    // Initialize CustomDropdown for device prefix
    if (dom.pagePrefixSelect)
    {
        dom.devicePrefixDropdown = new CustomDropdown(dom.pagePrefixSelect, {
            onChange: (item) =>
            {
                console.log('[DevicePrefix] Changed to:', item.value);
            }
        });
    }

    dom.pageSaveBtn = document.getElementById('template-page-save-btn');
    dom.pageCancelBtn = document.getElementById('template-page-cancel-btn');
    dom.pageDeleteBtn = document.getElementById('template-page-delete-btn');
    dom.customAxisModal = document.getElementById('custom-axis-modal');
    dom.customAxisTable = document.getElementById('custom-axis-table');
    dom.customAxisSaveBtn = document.getElementById('custom-axis-save-btn');
    dom.customAxisCancelBtn = document.getElementById('custom-axis-cancel-btn');
    dom.customAxisResetBtn = document.getElementById('custom-axis-reset-btn');
    dom.startAxisDetectionBtn = document.getElementById('start-axis-detection-btn');
    dom.stopAxisDetectionBtn = document.getElementById('stop-axis-detection-btn');
    dom.axisDetectionStatus = document.getElementById('axis-detection-status');
    dom.pageLoadImageBtn = document.getElementById('page-load-image-btn');
    dom.pageClearImageBtn = document.getElementById('page-clear-image-btn');
    dom.pageImageInfo = document.getElementById('page-image-info');
    dom.pageMirrorSelect = document.getElementById('page-mirror-select');

    // Initialize CustomDropdown for mirror select
    if (dom.pageMirrorSelect)
    {
        dom.pageMirrorDropdown = new CustomDropdown(dom.pageMirrorSelect, {
            onChange: (item) =>
            {
                console.log('[MirrorDropdown] Changed to:', item.value);
            }
        });
    }

    if (!dom.pagesList)
    {
        return;
    }

    dom.pagesList.addEventListener('click', handlePagesListClick);
    dom.addPageBtn?.addEventListener('click', () => openPageModal());

    // Import device button
    const importDeviceBtn = document.getElementById('import-device-btn');
    importDeviceBtn?.addEventListener('click', () => importDevice());

    dom.pageCancelBtn?.addEventListener('click', closePageModal);
    dom.pageSaveBtn?.addEventListener('click', savePageFromModal);
    dom.pageDeleteBtn?.addEventListener('click', () =>
    {
        if (state.modalEditingPageId)
        {
            deletePage(state.modalEditingPageId);
            closePageModal();
        }
    });

    dom.pageLoadImageBtn?.addEventListener('click', handlePageImageLoad);
    dom.pageClearImageBtn?.addEventListener('click', clearPageImage);

    state.initialized = true;

    window.templateV2State = state;

    refreshTemplatePagesUI(options?.template || null);
}

export function refreshTemplatePagesUI(templateOverride = null)
{
    let templateRef = templateOverride;
    if (!templateRef && typeof callbacks.getTemplate === 'function')
    {
        templateRef = callbacks.getTemplate();
    }

    if (!templateRef || typeof templateRef !== 'object')
    {
        templateRef = cloneDeep(DEFAULT_TEMPLATE_V2);
    }

    // Migrate template if needed (v1.0 -> v1.1)
    if (templateRef.version === '1.0' || !templateRef.version)
    {
        migrateTemplateToV11(templateRef);
    }

    if (!Array.isArray(templateRef.pages))
    {
        templateRef.pages = [];
    }

    templateRef.pages.forEach(page =>
    {
        if (!page.id)
        {
            page.id = generatePageId();
        }
    });

    state.template = templateRef;

    if (state.selectedPageId && !state.template.pages.find(page => page.id === state.selectedPageId))
    {
        state.selectedPageId = null;
    }

    if (!state.selectedPageId && state.template.pages.length)
    {
        state.selectedPageId = state.template.pages[0].id;
        // Trigger callback so template-editor.js can load the page
        callbacks.onPageSelected?.(state.selectedPageId);
    }
    else if (state.selectedPageId && state.template.pages.length)
    {
        // If a page is already selected, ensure it's still loaded
        // This handles the case where refreshTemplatePagesUI is called after template changes
        callbacks.onPageSelected?.(state.selectedPageId);
    }
    else if (!state.template.pages.length)
    {
        callbacks.onPageSelected?.(null);
    }

    renderPageList();
}

// Expose selectPage to window so other modules can select pages
window.selectPage = selectPage;

// ============================================
// Device Export/Import Functionality
// ============================================

/**
 * Export a single device (page) to a JSON file
 * @param {string} pageId - The ID of the page/device to export
 */
async function exportDevice(pageId)
{
    const page = state.template.pages.find(p => p.id === pageId);
    if (!page)
    {
        console.error('[ExportDevice] Page not found:', pageId);
        return;
    }

    // Create a clean copy for export
    const exportData = cloneDeep(page);

    // Generate a new ID so the imported device doesn't conflict
    delete exportData.id;

    // Wrap in a device export format with metadata
    const deviceExport = {
        type: 'boxxy-binder-device',
        version: '1.0',
        exportedAt: new Date().toISOString(),
        device: exportData
    };

    const invoke = getInvoke();
    if (!invoke)
    {
        // Fallback: download via browser
        const blob = new Blob([JSON.stringify(deviceExport, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeName = (page.name || 'device').replace(/[^a-zA-Z0-9-_ ]/g, '').trim();
        a.download = `${safeName}.device.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (window.showToast)
        {
            window.showToast(`Exported "${page.name || 'Untitled Device'}"`, 'success');
        }
        return;
    }

    try
    {
        // Use Tauri save dialog
        const { save } = window.__TAURI__.dialog;

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

        const safeName = (page.name || 'device').replace(/[^a-zA-Z0-9-_ ]/g, '').trim();

        const filePath = await save({
            filters: [{
                name: 'Device Template',
                extensions: ['device.json']
            }],
            defaultPath: resourceDir ? `${resourceDir}/${safeName}.device.json` : `${safeName}.device.json`
        });

        if (!filePath) return; // User cancelled

        await invoke('save_template', {
            filePath,
            templateJson: JSON.stringify(deviceExport, null, 2)
        });

        if (window.showToast)
        {
            window.showToast(`Exported "${page.name || 'Untitled Device'}"`, 'success');
        }
    }
    catch (error)
    {
        console.error('[ExportDevice] Error:', error);
        const showAlert = window.showAlert || alert;
        await showAlert(`Failed to export device: ${error}`, 'Export Error');
    }
}

/**
 * Import a device from a JSON file and add it to the current template
 */
async function importDevice()
{
    const invoke = getInvoke();

    if (!invoke)
    {
        // Fallback: use file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.device.json';
        input.onchange = async (e) =>
        {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (event) =>
            {
                try
                {
                    const data = JSON.parse(event.target.result);
                    await processImportedDevice(data, file.name);
                }
                catch (error)
                {
                    console.error('[ImportDevice] Parse error:', error);
                    const showAlert = window.showAlert || alert;
                    await showAlert('Failed to parse device file. Make sure it\'s a valid device export.', 'Import Error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
        return;
    }

    try
    {
        // Use Tauri open dialog
        const { open } = window.__TAURI__.dialog;

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

        const filePath = await open({
            filters: [{
                name: 'Device Template',
                extensions: ['json', 'device.json']
            }],
            multiple: false,
            defaultPath: resourceDir
        });

        if (!filePath) return; // User cancelled

        const fileContent = await invoke('load_template', { filePath });
        const data = JSON.parse(fileContent);
        const fileName = filePath.split(/[\\/]/).pop();

        await processImportedDevice(data, fileName);
    }
    catch (error)
    {
        console.error('[ImportDevice] Error:', error);
        const showAlert = window.showAlert || alert;
        await showAlert(`Failed to import device: ${error}`, 'Import Error');
    }
}

/**
 * Process and add an imported device to the template
 * @param {Object} data - The parsed JSON data
 * @param {string} fileName - The name of the imported file (for error messages)
 */
async function processImportedDevice(data, fileName)
{
    const showAlert = window.showAlert || alert;

    // Validate the data format
    let deviceData;

    if (data.type === 'boxxy-binder-device' && data.device)
    {
        // New device export format
        deviceData = cloneDeep(data.device);
    }
    else if (data.pages && Array.isArray(data.pages) && data.pages.length > 0)
    {
        // Full template file - ask user which device to import
        const pageNames = data.pages.map((p, i) => `${i + 1}. ${p.name || 'Untitled Device'}`).join('\n');

        // For simplicity, import the first device. Could add a selection modal later.
        const showConfirmation = window.showConfirmation;
        if (showConfirmation)
        {
            const confirmed = await showConfirmation(
                `This file contains ${data.pages.length} device(s):\n${pageNames}\n\nImport the first device?`,
                'Import from Template',
                'Import First Device',
                'Cancel'
            );
            if (!confirmed) return;
        }

        deviceData = cloneDeep(data.pages[0]);
    }
    else if (data.name && (data.buttons || data.device_prefix))
    {
        // Looks like a raw device/page object
        deviceData = cloneDeep(data);
    }
    else
    {
        await showAlert(
            'This file doesn\'t appear to be a valid device export.\n\nExpected a .device.json file or a template file.',
            'Invalid File Format'
        );
        return;
    }

    // Generate a new unique ID
    deviceData.id = generatePageId();

    // Check for name conflicts and append a number if needed
    let baseName = deviceData.name || 'Imported Device';
    let finalName = baseName;
    let counter = 1;

    while (state.template.pages.some(p => p.name === finalName))
    {
        counter++;
        finalName = `${baseName} (${counter})`;
    }
    deviceData.name = finalName;

    // Ensure buttons array exists
    if (!Array.isArray(deviceData.buttons))
    {
        deviceData.buttons = [];
    }

    // Add to template
    state.template.pages.push(deviceData);

    // Select the newly imported device
    state.selectedPageId = deviceData.id;

    // Mark as dirty and refresh
    markTemplateDirty();
    renderPageList();
    callbacks.onPagesChanged?.(state.template.pages);
    callbacks.onPageSelected?.(deviceData.id);

    if (window.showToast)
    {
        window.showToast(`Imported "${deviceData.name}"`, 'success');
    }
}

// Expose importDevice to window so the import button can call it
window.importDevice = importDevice;
window.deletePageWithConfirmation = deletePageWithConfirmation;
