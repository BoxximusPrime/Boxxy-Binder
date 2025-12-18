/**
 * CustomDropdown - A custom dropdown implementation with support for side tooltips on options
 */
export class CustomDropdown
{
    constructor(element, options = {})
    {
        this.element = element;
        this.options = options;
        this.isOpen = false;
        this.isSelecting = false; // Flag to prevent toggle during selection
        this.selectedIndex = 0;
        this.optionTooltips = options.optionTooltips || {};
        this.onChange = options.onChange || null;
        this.hoverTooltip = null;
        this.hideTooltipTimeout = null;

        this.init();
    }

    init()
    {
        // Create wrapper
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'custom-dropdown-wrapper';

        // Create button
        this.button = document.createElement('button');
        this.button.className = 'custom-dropdown-button';
        this.button.setAttribute('type', 'button');
        this.button.setAttribute('aria-haspopup', 'listbox');

        // Create dropdown menu
        this.menu = document.createElement('div');
        this.menu.className = 'custom-dropdown-menu';
        this.menu.setAttribute('role', 'listbox');

        // Create options
        if (this.element.tagName === 'SELECT')
        {
            this.populateFromSelect();
        } else
        {
            this.items = this.options.items || [];
            this.renderOptions();
        }

        // Set initial button text
        this.updateButtonText();

        // Append to wrapper
        this.wrapper.appendChild(this.button);
        this.wrapper.appendChild(this.menu);

        // Replace original element with wrapper
        this.element.parentNode.replaceChild(this.wrapper, this.element);
        this.wrapper.appendChild(this.element);
        this.element.style.display = 'none';

        // Event listeners
        this.button.addEventListener('click', (e) =>
        {
            // Don't toggle if we're in the middle of selecting an option
            if (this.isSelecting)
            {
                return;
            }
            e.stopPropagation();
            this.toggle();
        });

        document.addEventListener('click', (e) => this.handleOutsideClick(e));
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
    }

    populateFromSelect()
    {
        this.items = Array.from(this.element.options).map((opt, index) => ({
            value: opt.value,
            label: opt.textContent,
            tooltip: this.optionTooltips[opt.value] || null,
            selected: opt.selected
        }));

        if (this.element.selectedIndex >= 0)
        {
            this.selectedIndex = this.element.selectedIndex;
        }

        this.renderOptions();
    }

    renderOptions()
    {
        this.menu.innerHTML = '';

        this.items.forEach((item, index) =>
        {
            const optionContainer = document.createElement('div');
            optionContainer.className = 'custom-dropdown-option-container';

            const option = document.createElement('button');
            option.className = 'custom-dropdown-option';
            option.setAttribute('type', 'button');
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', index === this.selectedIndex);
            if (index === this.selectedIndex)
            {
                option.classList.add('selected');
            }

            option.textContent = item.label;
            option.dataset.index = index;

            option.addEventListener('click', (e) =>
            {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this.selectOption(index);
            });

            // Add hover tooltip if available
            if (item.tooltip)
            {
                option.setAttribute('data-tooltip', item.tooltip);

                option.addEventListener('mouseenter', (e) => this.showHoverTooltip(e, item.tooltip));
                option.addEventListener('mouseleave', () => this.hideHoverTooltip());
            }

            optionContainer.appendChild(option);
            this.menu.appendChild(optionContainer);
        });
    }

    showHoverTooltip(event, tooltipText)
    {
        // Clear any pending hide timeout
        if (this.hideTooltipTimeout)
        {
            clearTimeout(this.hideTooltipTimeout);
            this.hideTooltipTimeout = null;
        }

        // Remove any existing hover tooltip
        if (this.hoverTooltip)
        {
            this.hoverTooltip.classList.remove('visible');
            this.hoverTooltip.remove();
        }

        const tooltip = document.createElement('div');
        tooltip.className = 'custom-dropdown-hover-tooltip';
        tooltip.textContent = tooltipText;

        document.body.appendChild(tooltip);
        this.hoverTooltip = tooltip;

        // Position tooltip to the right of the menu
        const menuRect = this.menu.getBoundingClientRect();
        const optionRect = event.target.getBoundingClientRect();

        tooltip.style.top = optionRect.top + 'px';
        tooltip.style.left = menuRect.right + 'px';

        // Allow tooltip to receive mouse events so it doesn't disappear when hovering over it
        tooltip.addEventListener('mouseenter', () =>
        {
            if (this.hideTooltipTimeout)
            {
                clearTimeout(this.hideTooltipTimeout);
                this.hideTooltipTimeout = null;
            }
        });

        tooltip.addEventListener('mouseleave', () => this.hideHoverTooltip());

        // Trigger reflow for animation
        void tooltip.offsetWidth;
        tooltip.classList.add('visible');
    }

    hideHoverTooltip()
    {
        if (this.hoverTooltip)
        {
            // Clear any pending timeout first
            if (this.hideTooltipTimeout)
            {
                clearTimeout(this.hideTooltipTimeout);
            }

            this.hoverTooltip.classList.remove('visible');
            this.hideTooltipTimeout = setTimeout(() =>
            {
                if (this.hoverTooltip && this.hoverTooltip.parentNode)
                {
                    this.hoverTooltip.remove();
                }
                this.hoverTooltip = null;
                this.hideTooltipTimeout = null;
            }, 200);
        }
    }

    updateButtonText()
    {
        if (this.selectedIndex < this.items.length)
        {
            this.button.textContent = this.items[this.selectedIndex].label;
        }
    }

    selectOption(index)
    {
        // Set flag to prevent toggle from firing
        this.isSelecting = true;

        this.selectedIndex = index;
        this.hideHoverTooltip();
        this.updateButtonText();

        // Update original select element BEFORE closing
        if (this.element.tagName === 'SELECT')
        {
            this.element.selectedIndex = index;
            this.element.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Call onChange callback BEFORE closing
        if (this.onChange)
        {
            this.onChange(this.items[index]);
        }

        this.close();

        // Render options AFTER closing to update the selected state
        // This prevents the click from bubbling to a recreated DOM element
        this.renderOptions();

        // Reset flag after a short delay to allow any pending events to clear
        setTimeout(() =>
        {
            this.isSelecting = false;
        }, 100);
    }

    toggle()
    {
        if (this.isOpen)
        {
            this.close();
        } else
        {
            this.open();
        }
    }

    open()
    {
        this.isOpen = true;
        this.menu.style.display = 'block';
        this.button.setAttribute('aria-expanded', 'true');
        this.button.classList.add('open');
        this.wrapper.classList.add('open');

        // Calculate position for fixed menu
        const rect = this.button.getBoundingClientRect();

        // Get menu dimensions
        const menuWidth = rect.width; // Match button width exactly

        this.menu.style.width = menuWidth + 'px';
    }

    close()
    {
        this.isOpen = false;
        this.menu.style.display = 'none';
        this.button.setAttribute('aria-expanded', 'false');
        this.button.classList.remove('open');
        this.wrapper.classList.remove('open');
        this.hideHoverTooltip();
    }

    handleOutsideClick(e)
    {
        if (!this.wrapper.contains(e.target) && this.isOpen)
        {
            this.close();
        }
    }

    handleKeyboard(e)
    {
        if (!this.isOpen) return;

        switch (e.key)
        {
            case 'ArrowDown':
                e.preventDefault();
                this.selectOption(Math.min(this.selectedIndex + 1, this.items.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.selectOption(Math.max(this.selectedIndex - 1, 0));
                break;
            case 'Enter':
                e.preventDefault();
                this.close();
                break;
            case 'Escape':
                e.preventDefault();
                this.close();
                break;
        }
    }

    getValue()
    {
        return this.items[this.selectedIndex]?.value || null;
    }

    setValue(value)
    {
        const index = this.items.findIndex(item => item.value === value);
        if (index >= 0)
        {
            this.selectOption(index);
        }
    }

    destroy()
    {
        // Clean up event listeners
        if (this.hideTooltipTimeout)
        {
            clearTimeout(this.hideTooltipTimeout);
            this.hideTooltipTimeout = null;
        }

        // Remove hover tooltip if it exists
        if (this.hoverTooltip && this.hoverTooltip.parentNode)
        {
            this.hoverTooltip.remove();
            this.hoverTooltip = null;
        }

        // Remove wrapper and restore original select element
        if (this.wrapper && this.wrapper.parentNode)
        {
            // Show original element again
            this.element.style.display = '';

            // Replace wrapper with original element
            this.wrapper.parentNode.replaceChild(this.element, this.wrapper);
        }

        // Clear references
        this.button = null;
        this.menu = null;
        this.wrapper = null;
        this.items = null;
    }
}
