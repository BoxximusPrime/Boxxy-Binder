// ============================================================================
// Shared Button Rendering Utilities
// ============================================================================
// This module provides consistent button and box rendering functions
// for both the template editor and joystick viewer.

// ========================================
// Constants
// ========================================

export const ButtonFrameWidth = 140;
export const ButtonFrameHeight = 60;
export const HatFrameWidth = 110;
export const HatFrameHeight = 50;
export const HatButtonGap = 4;
export const NumLines = 3;
export const HatSpacing = 6;

// ========================================
// Drawing Helper Functions
// ========================================

/**
 * Draw a rounded rectangle path
 */
export function roundRect(ctx, x, y, width, height, radius)
{
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

/**
 * Simplify button names for display
 * Removes prefixes and standardizes common patterns
 */
export function simplifyButtonName(name)
{
    if (!name) return 'Button';

    // Remove "Joystick 1 - " or "Button Button" prefixes
    name = name.replace(/^Joystick \d+ - /, '');
    name = name.replace(/^Button /, '');

    // Simplify common patterns
    name = name.replace(/Button\((\d+)\)/, 'Btn $1');
    name = name.replace(/^(\d+)$/, 'Btn $1');

    return name;
}

/**
 * Draw a connecting line between button marker and label box
 * Uses smart positioning to attach to the nearest edge of the label box
 */
export function drawConnectingLine(ctx, buttonPos, labelPos, boxHalfWidth, lineColor, isHat = false)
{
    // For hats, draw straight line to center without offset
    if (isHat)
    {
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(buttonPos.x, buttonPos.y);
        ctx.lineTo(labelPos.x, labelPos.y);
        ctx.stroke();
        ctx.setLineDash([]);
        return;
    }

    // For regular buttons, calculate label box dimensions
    const labelWidth = boxHalfWidth * 2;
    const labelHeight = ButtonFrameHeight;
    const labelX = labelPos.x - boxHalfWidth;
    const labelY = labelPos.y - labelHeight / 2;
    const labelRight = labelX + labelWidth;
    const labelLeft = labelX;
    const labelCenterY = labelPos.y;

    // Determine which edge to attach to and draw offset line
    let attachX, attachY = labelCenterY;
    let offsetX, offsetY = labelCenterY;
    const offset = 23;

    if (buttonPos.x < labelX)
    {
        // Button is to the left - attach to left edge
        attachX = labelLeft;
        offsetX = labelLeft - offset;
    } else if (buttonPos.x > labelRight)
    {
        // Button is to the right - attach to right edge
        attachX = labelRight;
        offsetX = labelRight + offset;
    } else
    {
        // Button is horizontally within box - attach to top or bottom edge
        attachX = buttonPos.x;
        if (buttonPos.y < labelY)
        {
            attachY = labelY;
            offsetY = labelY - offset;
        } else
        {
            attachY = labelY + labelHeight;
            offsetY = labelY + labelHeight + offset;
        }
        offsetX = buttonPos.x;
    }

    // Draw dashed line from button to offset point to label edge
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(buttonPos.x, buttonPos.y);
    ctx.lineTo(offsetX, offsetY);
    ctx.lineTo(attachX, attachY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw circle at connection point
    ctx.fillStyle = '#aaaaaaff';
    ctx.strokeStyle = '#aaaaaaff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(attachX, attachY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
}

/**
 * Draw a single button marker (the circle on the image)
 */
export function drawButtonMarker(ctx, buttonPos, zoom, hasBinding = false, isHat = false)
{
    const handleSize = isHat ? 6 : (7 / zoom);
    ctx.fillStyle = hasBinding ? '#d9534f' : '#666';
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2 / zoom;
    ctx.beginPath();
    ctx.arc(buttonPos.x, buttonPos.y, handleSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
}

/**
 * Draw a binding box with button info and bindings
 * NEW IMPROVED VERSION: Accepts title and content lines array for flexible rendering
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - Center X position
 * @param {number} y - Center Y position
 * @param {string} title - Title text (styled differently, shown at top)
 * @param {Array<string>} contentLines - Array of content strings to display
 * @param {boolean} compact - Use compact layout for hat directions
 * @param {Object} options - Additional options (hasBinding, buttonData, mode, onClickableBox, titleColor, contentColor, actionColor, bindingsData)
 */
export function drawButtonBox(ctx, x, y, title, contentLines = [], compact = false, options = {})
{
    const {
        hasBinding = contentLines.length > 0,
        buttonData = null,
        mode = 'normal',
        onClickableBox = null,
        titleColor = '#ccc',
        contentColor = '#ddd',
        subtleColor = '#999',
        mutedColor = '#666',
        actionColor = null,
        bindingsData = null
    } = options;

    const width = compact ? HatFrameWidth : ButtonFrameWidth;
    const height = ButtonFrameHeight;

    const boxX = x - width / 2;
    const boxY = y - height / 2;

    // Box background
    ctx.fillStyle = hasBinding ? 'rgba(15, 18, 21, 0.95)' : 'rgba(30, 30, 30, 0.85)';
    ctx.strokeStyle = hasBinding ? '#c9c9c9ff' : '#555';
    ctx.lineWidth = 1;

    // Rounded rectangle
    roundRect(ctx, boxX, boxY, width, height, 4);
    ctx.fill();
    ctx.stroke();

    // Track clickable area if callback is provided
    if (hasBinding && buttonData && mode === 'normal' && onClickableBox)
    {
        onClickableBox({
            x: boxX,
            y: boxY,
            width: width,
            height: height,
            buttonData: buttonData,
            bindings: bindingsData || contentLines
        });
    }

    // Render text using improved function
    RenderFrameText(ctx, x, y, width, height, title, contentLines, compact, {
        titleColor,
        contentColor,
        subtleColor,
        mutedColor,
        actionColor
    });
}

/**
 * Improved text rendering for button boxes
 * Handles title, multiple content lines, truncation, and alignment
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - Center X position
 * @param {number} y - Center Y position
 * @param {number} boxWidth - Box width
 * @param {number} boxHeight - Box height
 * @param {string} title - Title text at top
 * @param {Array<string>} contentLines - Array of content strings
 * @param {boolean} compact - Use compact layout
 * @param {Object} colors - Color options (titleColor, contentColor, subtleColor, mutedColor, actionColor)
 */
export function RenderFrameText(ctx, x, y, boxWidth, boxHeight, title, contentLines = [], compact = false, colors = {})
{
    const {
        titleColor = '#ccc',
        contentColor = '#ddd',
        subtleColor = '#999',
        mutedColor = '#666',
        actionColor = null
    } = colors;

    // Calculate text layout metrics
    const padding = 4;
    const contentWidth = boxWidth - (padding * 2);
    const lineHeight = compact ? 11 : 12;
    const titleFontSize = compact ? '11px' : '12px';
    const contentFontSize = compact ? '9px' : '10px';
    const countFontSize = compact ? '8px' : '9px';
    const titleSpacing = compact ? 14 : 18;

    // Helper function to truncate text to fit width
    const truncateText = (text, font, maxWidth, ellipsis = true) =>
    {
        ctx.font = font;
        if (ctx.measureText(text).width <= maxWidth)
        {
            return text;
        }

        const suffix = ellipsis ? '...' : '';
        let truncated = text;

        while (truncated.length > 0 && ctx.measureText(truncated + suffix).width > maxWidth)
        {
            truncated = truncated.slice(0, -1);
        }
        return truncated + suffix;
    };

    // Draw title at top
    ctx.fillStyle = titleColor;
    ctx.font = `${titleFontSize} "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const titleY = y - (boxHeight / 2) + (titleSpacing / 2) + padding;
    const truncatedTitle = truncateText(title, ctx.font, contentWidth, true);
    ctx.fillText(truncatedTitle, x, titleY);

    // Calculate content area
    const contentHeight = boxHeight - titleSpacing;
    const maxLinesAvailable = Math.floor(contentHeight / lineHeight);

    // If no content, show placeholder
    if (!contentLines || contentLines.length === 0)
    {
        ctx.fillStyle = mutedColor;
        ctx.font = `italic ${contentFontSize} "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('(unbound)', x, y + 2);
        return;
    }

    // Determine how many lines we can show
    // For non-compact boxes, limit to NumLines; for compact, use available space
    const maxDisplayLines = compact ? maxLinesAvailable : NumLines;
    const linesToShow = Math.min(maxDisplayLines, contentLines.length);
    const showMoreIndicator = contentLines.length > linesToShow;

    // Calculate starting Y position for content (vertically center the content area)
    const actualLines = showMoreIndicator ? linesToShow - 1 : linesToShow;
    const totalTextHeight = actualLines * lineHeight;
    const contentAreaStartY = y - (boxHeight / 2) + titleSpacing;
    const startY = contentAreaStartY + (contentHeight - totalTextHeight) / 2;

    // Render content lines
    for (let i = 0; i < actualLines; i++)
    {
        const lineY = startY + (i * lineHeight);
        const line = contentLines[i];

        // Parse line for styling hints (e.g., "[subtle]text" or "[muted]text")
        let displayText = line;
        let color = contentColor;

        if (line.startsWith('[action]'))
        {
            displayText = line.substring(8);
            color = actionColor || contentColor;
        } else if (line.startsWith('[subtle]'))
        {
            displayText = line.substring(8);
            color = subtleColor;
        } else if (line.startsWith('[muted]'))
        {
            displayText = line.substring(7);
            color = mutedColor;
        } else if (line.startsWith('[bright]'))
        {
            displayText = line.substring(8);
            color = contentColor;
        }

        ctx.fillStyle = color;
        ctx.font = `${contentFontSize} "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const truncated = truncateText(displayText, ctx.font, contentWidth, true);
        ctx.fillText(truncated, x, lineY);
    }

    // Show "more" indicator if needed
    if (showMoreIndicator)
    {
        const remainingCount = contentLines.length - actualLines;
        const lineY = startY + (actualLines * lineHeight);

        ctx.fillStyle = '#aaa';
        ctx.font = `${countFontSize} "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const countText = `+${remainingCount} more`;
        const countWidth = ctx.measureText(countText).width;
        const bgPadding = 4;

        // Draw background for count
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        roundRect(ctx, x - countWidth / 2 - bgPadding, lineY - lineHeight / 2, countWidth + bgPadding * 2, lineHeight, 2);
        ctx.fill();

        ctx.fillStyle = '#aaa';
        ctx.fillText(countText, x, lineY);
    }
}

/**
 * Build content lines for a button label
 * Prepares title and content array for rendering
 * @returns {Object} Object with title and contentLines array
 */
export function buildButtonLabelContent(button)
{
    const title = simplifyButtonName(button.name || 'Button');
    const contentLines = [];

    // Extract button ID
    let displayButtonId = null;
    if (button.buttonId !== undefined)
    {
        displayButtonId = button.buttonId;
    } else if (button.inputs && button.inputs.main)
    {
        const match = button.inputs.main.match(/button(\d+)/i);
        if (match)
        {
            displayButtonId = match[1];
        }
    }

    // Add button ID to content
    if (displayButtonId !== null)
    {
        contentLines.push(`[subtle]Button ${displayButtonId}`);
    }

    // Check if button has a binding
    const hasBound = button.inputs && (button.inputs.main || button.buttonId !== undefined);
    if (!hasBound)
    {
        contentLines.push('[muted](unbound)');
    }

    return { title, contentLines };
}

/**
 * Draw a label box for a button or hat direction
 * Unified rendering for both regular buttons and hat directions
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - Center X position
 * @param {number} y - Center Y position
 * @param {string} title - Label title text
 * @param {Array<string>} contentLines - Array of content lines to display
 * @param {boolean} compact - Use compact layout (for hat directions)
 * @param {number} alpha - Opacity (0-1)
 * @param {Object} colors - Optional color overrides
 */
export function DrawButtonFrame(ctx, x, y, title, contentLines, compact = false, alpha = 1, colors = {})
{
    ctx.save();
    ctx.globalAlpha = alpha;

    const width = compact ? HatFrameWidth : ButtonFrameWidth;
    const height = ButtonFrameHeight;
    const boxX = x - width / 2;
    const boxY = y - height / 2;
    const radius = 4;

    // Box background
    ctx.fillStyle = 'rgba(30, 30, 30, 0.85)';
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1.0;

    roundRect(ctx, boxX, boxY, width, height, radius);
    ctx.fill();
    ctx.stroke();

    // Use improved rendering with color defaults
    const defaultColors = {
        titleColor: '#ccc',
        contentColor: '#ddd',
        subtleColor: '#999',
        mutedColor: '#666'
    };

    RenderFrameText(ctx, x, y, width, height, title, contentLines, compact, {
        ...defaultColors,
        ...colors
    });

    ctx.restore();
}

/**
 * Draw a single button label box (for template editor)
 * @deprecated Use drawLabel instead for unified rendering
 */
export function drawButtonLabel(ctx, button, title, contentLines, alpha)
{
    DrawButtonFrame(ctx, button.labelPos.x, button.labelPos.y, title, contentLines, false, alpha);
}

/**
 * Draw a single button with label (for template editor)
 * Convenience function that combines label content building and rendering
 * @deprecated Use buildButtonLabelContent + drawButtonLabel instead for better separation of concerns
 */
export function drawSingleButtonLabel(ctx, button, alpha)
{
    const { title, contentLines } = buildButtonLabelContent(button);
    drawButtonLabel(ctx, button, title, contentLines, alpha);
}

/**
 * Calculate hat positions for a 4-way hat switch
 * Returns an object with positions for each direction
 */
export function getHat4WayPositions(centerX, centerY, hasPush = false)
{
    let offsetY = (HatFrameHeight / 2) + (HatSpacing * 2) + (HatSpacing / 2) + (HatFrameHeight / 2);
    if (!hasPush) offsetY -= HatFrameHeight / 2 + HatSpacing;

    return {
        'up': { x: centerX, y: centerY - offsetY },
        'down': { x: centerX, y: centerY + offsetY },
        'left': { x: centerX - HatFrameWidth - HatSpacing, y: centerY },
        'right': { x: centerX + HatFrameWidth + HatSpacing, y: centerY },
        'push': { x: centerX, y: centerY }
    };
}

/**
 * Get box bounds for a specific hat direction
 * Useful for hit testing and bounds checking
 */
export function getHat4WayBoxBounds(direction, centerX, centerY, hasPush = false)
{
    const positions = getHat4WayPositions(centerX, centerY, hasPush);
    if (!positions[direction])
    {
        return null;
    }

    const pos = positions[direction];
    const halfWidth = HatFrameWidth / 2;
    const halfHeight = HatFrameHeight / 2;

    return {
        x: pos.x - halfWidth,
        y: pos.y - halfHeight,
        width: HatFrameWidth,
        height: HatFrameHeight
    };
}

/**
 * Unified function to draw 4-way hat boxes with customizable content and styling
 * Used by both template editor and joystick viewer for consistent rendering
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} hat - Hat button data
 * @param {Object} options - Rendering options
 * @param {string} options.mode - 'template' or 'viewer' mode
 * @param {number} options.alpha - Opacity (0-1)
 * @param {Function} options.getContentForDirection - Function(direction, input) that returns array of content lines
 * @param {Object} options.colors - Color overrides (titleColor, contentColor, subtleColor, mutedColor, actionColor)
 * @param {Function} options.onClickableBox - Callback for registering clickable boxes
 * @param {Object} options.buttonDataForDirection - Function(direction) that returns buttonData for clickable tracking
 */
export function drawHat4WayBoxes(ctx, hat, options = {})
{
    const {
        mode = 'template',
        alpha = 1,
        getContentForDirection = null,
        colors = {},
        onClickableBox = null,
        buttonDataForDirection = null,
        bindingsByDirection = null
    } = options;

    ctx.save();
    ctx.globalAlpha = alpha;

    const boxWidth = HatFrameWidth;
    const boxHeight = HatFrameHeight;
    const radius = 4;

    // Check if push button exists
    const hasPush = hat.inputs && hat.inputs['push'];

    // Calculate all positions using centralized helper
    const positions = getHat4WayPositions(hat.labelPos.x, hat.labelPos.y, hasPush);

    // Calculate spacing for hat name position
    // When there's a push button, the up direction is pushed down further, so we need more spacing above
    let offsetY = HatFrameHeight * 2;
    if (!hasPush) offsetY -= HatFrameHeight / 2 + HatSpacing;

    const titleGap = 12;
    const titleY = hat.labelPos.y - offsetY - titleGap;

    // Draw hat name above
    ctx.fillStyle = colors.titleColor || '#aaa';
    ctx.font = '13px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const simplifiedName = simplifyButtonName(hat.name || 'Hat');
    ctx.fillText(simplifiedName, hat.labelPos.x, titleY);

    // Draw each direction box
    const directions = ['up', 'down', 'left', 'right', 'push'];
    directions.forEach(dir =>
    {
        // Only draw if this direction has inputs
        if (!hat.inputs || !hat.inputs[dir])
        {
            return;
        }

        const pos = positions[dir];
        const input = hat.inputs[dir];

        // Get content lines for this direction
        let contentLines = [];
        if (getContentForDirection)
        {
            contentLines = getContentForDirection(dir, input);
        }

        // Determine label
        const label = dir === 'push' ? 'Push' : dir.charAt(0).toUpperCase();

        // For template mode, use unified label drawing
        if (mode === 'template')
        {
            DrawButtonFrame(ctx, pos.x, pos.y, label, contentLines, true, alpha, colors);
        }
        else
        {
            // Get actual bindings data if available
            const actualBindings = bindingsByDirection ? bindingsByDirection[dir] : null;

            // Use drawButtonBox for viewer mode with full functionality
            const boxOptions = {
                hasBinding: contentLines.length > 0,
                buttonData: buttonDataForDirection ? buttonDataForDirection(dir) : null,
                mode: mode,
                onClickableBox: onClickableBox,
                titleColor: colors.titleColor || '#ccc',
                contentColor: colors.contentColor || '#ddd',
                subtleColor: colors.subtleColor || '#999',
                mutedColor: colors.mutedColor || '#666',
                actionColor: colors.actionColor || null,
                bindingsData: actualBindings || contentLines
            };

            drawButtonBox(ctx, pos.x, pos.y, label, contentLines, true, boxOptions);
        }
    });

    ctx.restore();
}

/**
 * Draw hat switch labels in a plus pattern (for template editor)
 * Uses improved text rendering system
 */
export function drawHat4WayFrames(ctx, button, alpha, handleSize, zoom)
{
    // Use unified rendering function with template editor styling
    drawHat4WayBoxes(ctx, button, {
        mode: 'template',
        alpha: alpha,
        getContentForDirection: (dir, input) =>
        {
            const contentLines = [];
            // Show input if available
            const match = input.match(/button(\d+)/i);
            if (match)
            {
                contentLines.push(`[subtle]Btn ${match[1]}`);
            }
            return contentLines;
        },
        colors: {
            titleColor: '#aaa',
            contentColor: '#ddd',
            subtleColor: '#999',
            mutedColor: '#666'
        }
    });
}
