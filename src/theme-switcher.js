/**
 * Theme Switcher Module
 * Handles switching between different themes.
 */

const THEMES = {
    SCIFI: 'scifi',
    VSCODE: 'vscode',
    NEON: 'neon',
    GOLD: 'gold'
};

// Theme display configuration
const THEME_CONFIG = {
    [THEMES.SCIFI]: {
        name: 'Scifi',
        class: null // Default theme, no class needed
    },
    [THEMES.VSCODE]: {
        name: 'Red',
        class: 'theme-red'
    },
    [THEMES.NEON]: {
        name: 'Neon',
        class: 'theme-neon'
    },
    [THEMES.GOLD]: {
        name: 'Gold',
        class: 'theme-gold'
    }
};

const THEME_STORAGE_KEY = 'appTheme';
const DEFAULT_THEME = THEMES.SCIFI;

class ThemeSwitcher
{
    constructor()
    {
        this.currentTheme = this.loadTheme();
        this.themeButtons = [];
        this.initializeTheme();
        this.setupEventListeners();
    }

    /**
     * Load theme from localStorage, fallback to default
     */
    loadTheme()
    {
        const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
        // Validate saved theme exists in our config
        if (savedTheme && THEME_CONFIG[savedTheme])
        {
            return savedTheme;
        }
        // Handle legacy 'Scifi' value
        if (savedTheme === 'Scifi')
        {
            return THEMES.SCIFI;
        }
        return DEFAULT_THEME;
    }

    /**
     * Save theme to localStorage
     */
    saveTheme(theme)
    {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    }

    /**
     * Initialize the current theme on page load
     */
    initializeTheme()
    {
        this.applyTheme(this.currentTheme);
    }

    /**
     * Apply theme to the document
     */
    applyTheme(theme)
    {
        const root = document.documentElement;

        // Remove all theme classes
        Object.values(THEME_CONFIG).forEach(config =>
        {
            if (config.class)
            {
                root.classList.remove(config.class);
            }
        });

        // Apply the selected theme class (if not default)
        const themeConfig = THEME_CONFIG[theme];
        if (themeConfig && themeConfig.class)
        {
            root.classList.add(themeConfig.class);
        }

        this.currentTheme = theme;
        this.updateActiveButton();

        // Dispatch theme change event so canvases can refresh
        document.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
    }

    /**
     * Update which button shows as active
     */
    updateActiveButton()
    {
        this.themeButtons.forEach(btn =>
        {
            const btnTheme = btn.dataset.theme;
            if (btnTheme === this.currentTheme)
            {
                btn.classList.add('active');
            } else
            {
                btn.classList.remove('active');
            }
        });
    }

    /**
     * Setup event listeners for theme switching
     */
    setupEventListeners()
    {
        const container = document.getElementById('theme-switcher');
        if (!container) return;

        this.themeButtons = container.querySelectorAll('.theme-btn');

        this.themeButtons.forEach(btn =>
        {
            btn.addEventListener('click', () =>
            {
                const theme = btn.dataset.theme;
                if (theme && THEME_CONFIG[theme])
                {
                    this.applyTheme(theme);
                    this.saveTheme(theme);
                }
            });
        });

        // Set initial active state
        this.updateActiveButton();
    }

    /**
     * Get current theme name
     */
    getCurrentTheme()
    {
        return this.currentTheme;
    }

    /**
     * Get available themes
     */
    getAvailableThemes()
    {
        return Object.values(THEMES);
    }

    /**
     * Set a specific theme
     */
    setTheme(theme)
    {
        if (THEME_CONFIG[theme])
        {
            this.applyTheme(theme);
            this.saveTheme(theme);
        }
    }
}

// Initialize theme switcher when DOM is ready
if (document.readyState === 'loading')
{
    document.addEventListener('DOMContentLoaded', () =>
    {
        window.themeSwitcher = new ThemeSwitcher();
    });
} else
{
    window.themeSwitcher = new ThemeSwitcher();
}

export { ThemeSwitcher, THEMES };
