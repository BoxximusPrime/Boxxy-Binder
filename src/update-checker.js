/**
 * Update Checker Module
 * Checks GitHub releases for new versions and displays an indicator in the header
 */

const { invoke } = window.__TAURI__.core;

const UPDATE_CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours in milliseconds
const GITHUB_REPO = 'BoxximusPrime/Boxxy-Binder';
const RELEASES_PAGE = 'https://github.com/BoxximusPrime/Boxxy-Binder/releases';
const ALL_BINDS_MANIFEST_URL = 'https://raw.githubusercontent.com/BoxximusPrime/Boxxy-Binder/main/allbinds-manifest.json';

// Get current app version from the HTML
function getCurrentVersion()
{
    const versionEl = document.getElementById('app-version');
    if (!versionEl) return '0.0.0';

    const text = versionEl.textContent.trim();
    // Remove 'v' prefix if present (e.g., "v0.4.1" -> "0.4.1")
    return text.startsWith('v') ? text.substring(1) : text;
}

// Compare two semantic versions
// Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
// Handles pre-release identifiers (e.g., "0.5.0-beta" is treated as "0.5.0" for comparison)
function compareVersions(v1, v2)
{
    // Strip pre-release identifiers (e.g., "-beta", "-alpha", "-rc1")
    const stripPrerelease = (version) => version.split('-')[0];

    const cleanV1 = stripPrerelease(v1);
    const cleanV2 = stripPrerelease(v2);

    const parts1 = cleanV1.split('.').map(Number);
    const parts2 = cleanV2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++)
    {
        const part1 = parts1[i] || 0;
        const part2 = parts2[i] || 0;

        if (part1 < part2) return -1;
        if (part1 > part2) return 1;
    }

    return 0;
}

// Fetch the latest release from GitHub
async function fetchLatestRelease()
{
    try
    {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
            method: 'GET',
            headers: {
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!response.ok)
        {
            console.warn(`GitHub API returned status ${response.status}`);
            return null;
        }

        const data = await response.json();

        // Extract version from tag_name (e.g., "v0.5.0" -> "0.5.0")
        let version = data.tag_name || '';
        if (version.startsWith('v'))
        {
            version = version.substring(1);
        }

        return {
            version,
            url: data.html_url,
            releaseName: data.name || version
        };
    } catch (error)
    {
        console.warn('Failed to fetch latest release from GitHub:', error);
        return null;
    }
}

// Show update indicator in the header
function showUpdateIndicator(latestVersion)
{
    const updateInfoEl = document.getElementById('update-info');
    if (!updateInfoEl) return;

    // Clear any existing badge first
    updateInfoEl.innerHTML = '';

    // Create and add update badge
    const badge = document.createElement('span');
    badge.className = 'update-badge';
    badge.title = `Update available: v${latestVersion}`;
    // top of file

    // inside showUpdateIndicator
    badge.innerHTML = `✨ v${latestVersion} Available`;
    badge.style.cursor = 'pointer';
    // badge.style.animation = 'pulse 2s infinite';
    badge.style.width = '180px';

    // Click to open releases page
    badge.addEventListener('click', async (e) =>
    {
        e.preventDefault();
        e.stopPropagation();
        try
        {
            await invoke('open_url', { url: RELEASES_PAGE });
        } catch (error)
        {
            console.error('Failed to open releases page:', error);
        }
    });

    updateInfoEl.appendChild(badge);
}

// Remove update indicator from the header
function hideUpdateIndicator()
{
    const updateInfoEl = document.getElementById('update-info');
    if (!updateInfoEl) return;

    updateInfoEl.innerHTML = '';
}

function getStatusLines()
{
    return {
        app: localStorage.getItem('updateCheckStatusApp') || '',
        bindings: localStorage.getItem('updateCheckStatusBindings') || ''
    };
}

function setStatusLine(type, text)
{
    localStorage.setItem(`updateCheckStatus${type}`, text || '');
}

function renderCombinedStatus()
{
    const statusEl = document.getElementById('update-check-status');
    if (!statusEl) return;

    const lines = getStatusLines();
    const parts = [];

    if (lines.app) parts.push(`App: ${lines.app}`);
    if (lines.bindings) parts.push(`Base bindings: ${lines.bindings}`);

    if (parts.length === 0)
    {
        statusEl.style.display = 'none';
        statusEl.textContent = '';
        return;
    }

    statusEl.style.display = 'block';
    statusEl.textContent = parts.join('\n');
    statusEl.style.whiteSpace = 'pre-line';
}

function clearStoredBindingsUpdateNotice()
{
    localStorage.removeItem('allBindsUpdateNoticeShown');
}

function getBindingsIdentity(manifest)
{
    return manifest?.sha256 || manifest?.dataVersion || manifest?.downloadUrl || '';
}

async function calculateSha256Hex(text)
{
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}

async function fetchBindingsManifest()
{
    try
    {
        const response = await fetch(ALL_BINDS_MANIFEST_URL, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            },
            cache: 'no-store'
        });

        if (response.status === 404)
        {
            console.log('AllBinds manifest not found on GitHub yet - skipping remote bindings update check');
            return null;
        }

        if (!response.ok)
        {
            console.warn(`AllBinds manifest returned status ${response.status}`);
            return null;
        }

        return await response.json();
    } catch (error)
    {
        console.warn('Failed to fetch AllBinds manifest:', error);
        return null;
    }
}

async function checkForBindingsDatabaseUpdate(options = {})
{
    const {
        silentIfMissing = true,
        manual = false
    } = options;

    const remoteManifest = await fetchBindingsManifest();

    if (!remoteManifest)
    {
        if (manual && !silentIfMissing)
        {
            setStatusLine('Bindings', 'No remote manifest published yet.');
            renderCombinedStatus();
        }
        return { state: 'missing-manifest' };
    }

    const localStatus = await invoke('get_all_binds_update_status');
    const currentVersion = getCurrentVersion();
    const minimumVersion = remoteManifest.minAppVersion || null;

    if (minimumVersion && compareVersions(currentVersion, minimumVersion) < 0)
    {
        const message = `Update requires app v${minimumVersion}+.`;
        setStatusLine('Bindings', message);
        renderCombinedStatus();

        if (manual && window.toast)
        {
            window.toast.warning('A newer base bindings database is available, but it needs a newer app build.');
        }

        return { state: 'incompatible', minimumVersion };
    }

    const remoteIdentity = getBindingsIdentity(remoteManifest);
    const localIdentity = localStatus.sha256 || localStatus.dataVersion || '';

    if (remoteIdentity && remoteIdentity === localIdentity)
    {
        const versionLabel = remoteManifest.dataVersion || remoteManifest.gameVersion || 'current';
        setStatusLine('Bindings', `Up to date (${versionLabel}).`);
        renderCombinedStatus();
        return { state: 'up-to-date', version: versionLabel };
    }

    const xmlUrl = remoteManifest.downloadUrl;
    if (!xmlUrl)
    {
        const message = 'Manifest is missing downloadUrl.';
        setStatusLine('Bindings', message);
        renderCombinedStatus();
        return { state: 'invalid-manifest', message };
    }

    const response = await fetch(xmlUrl, {
        method: 'GET',
        cache: 'no-store'
    });

    if (!response.ok)
    {
        const message = `Failed to download remote XML (${response.status}).`;
        setStatusLine('Bindings', message);
        renderCombinedStatus();
        return { state: 'download-failed', message };
    }

    const xmlContent = await response.text();

    if (remoteManifest.sha256)
    {
        const actualSha256 = await calculateSha256Hex(xmlContent);
        if (actualSha256.toLowerCase() !== remoteManifest.sha256.toLowerCase())
        {
            const message = 'Downloaded XML did not match manifest hash.';
            setStatusLine('Bindings', message);
            renderCombinedStatus();
            return { state: 'hash-mismatch', message };
        }
    }

    const result = await invoke('apply_all_binds_update', {
        manifest: remoteManifest,
        xmlContent
    });

    const versionLabel = result.dataVersion || result.gameVersion || remoteManifest.dataVersion || 'latest';
    setStatusLine('Bindings', `Updated to ${versionLabel}.`);
    renderCombinedStatus();
    clearStoredBindingsUpdateNotice();

    const noticeKey = getBindingsIdentity(remoteManifest);
    const lastNoticeKey = localStorage.getItem('allBindsUpdateNoticeShown');
    if (window.toast && noticeKey && noticeKey !== lastNoticeKey)
    {
        window.toast.info(`Base bindings updated to ${versionLabel}.`, { title: 'Bindings Database Updated', duration: 6000 });
        localStorage.setItem('allBindsUpdateNoticeShown', noticeKey);
    }

    window.dispatchEvent(new CustomEvent('all-binds-updated', { detail: result }));

    return { state: 'updated', version: versionLabel };
}

async function runCombinedUpdateCheck(options = {})
{
    const {
        manual = false,
        showProgress = false
    } = options;

    if (showProgress)
    {
        setStatusLine('App', 'Checking...');
        setStatusLine('Bindings', 'Checking...');
        renderCombinedStatus();
    }

    const appResult = await checkForAppUpdates({ manual });
    const bindingsResult = await checkForBindingsDatabaseUpdate({ manual, silentIfMissing: !manual });

    return { appResult, bindingsResult };
}

async function checkForAppUpdates(options = {})
{
    const { manual = false } = options;
    const latestRelease = await fetchLatestRelease();

    if (!latestRelease)
    {
        console.log('Could not fetch latest release info');
        if (manual)
        {
            setStatusLine('App', 'Failed to check.');
            renderCombinedStatus();
        }
        return { state: 'error' };
    }

    const currentVersion = getCurrentVersion();
    console.log(`Current version: ${currentVersion}, Latest version: ${latestRelease.version}`);

    // Compare versions
    if (compareVersions(currentVersion, latestRelease.version) < 0)
    {
        console.log(`Update available: v${latestRelease.version}`);
        showUpdateIndicator(latestRelease.version);
        setStatusLine('App', `Update available (v${latestRelease.version}).`);
        renderCombinedStatus();

        // Store update info for potential later use
        localStorage.setItem('latestVersion', latestRelease.version);
        localStorage.setItem('updateCheckTime', Date.now().toString());
        return { state: 'update-available', version: latestRelease.version };
    } else
    {
        console.log('App is up to date');
        hideUpdateIndicator();
        setStatusLine('App', 'Up to date.');
        renderCombinedStatus();
        return { state: 'up-to-date', version: currentVersion };
    }
}

// Check if we should run an update check based on the interval
function shouldCheckForUpdates()
{
    const lastCheckTime = localStorage.getItem('updateCheckTime');

    if (!lastCheckTime)
    {
        return true; // First check
    }

    const timeSinceLastCheck = Date.now() - parseInt(lastCheckTime);
    return timeSinceLastCheck > UPDATE_CHECK_INTERVAL;
}

// Initialize the update checker
export async function initializeUpdateChecker()
{
    console.log('Initializing update checker...');
    renderCombinedStatus();

    // Check on startup if enough time has passed
    if (shouldCheckForUpdates())
    {
        await runCombinedUpdateCheck();
    } else
    {
        // Restore any previously detected update indicator
        const latestVersion = localStorage.getItem('latestVersion');
        if (latestVersion && compareVersions(getCurrentVersion(), latestVersion) < 0)
        {
            showUpdateIndicator(latestVersion);
        }

        renderCombinedStatus();
    }

    // Set up periodic checks every 4 hours
    setInterval(() =>
    {
        runCombinedUpdateCheck().catch(err =>
        {
            console.error('Error in update check interval:', err);
        });
    }, UPDATE_CHECK_INTERVAL);

    // Make manual check available globally
    window.manualUpdateCheck = manualUpdateCheck;

    // DEV: Key combo to show mock update (Ctrl+Alt+R, then T) - COMMENTED OUT FOR LIVE RELEASE
    // let devKeySequence = [];
    // window.addEventListener('keydown', (e) =>
    // {
    //     if (e.ctrlKey && e.altKey && e.code === 'KeyR')
    //     {
    //         devKeySequence = ['ctrl_alt_r'];
    //         console.log('[DEV] Step 1: Ctrl+Alt+R detected');
    //     } else if (devKeySequence.includes('ctrl_alt_r') && e.code === 'KeyT')
    //     {
    //         e.preventDefault();
    //         console.log('[DEV] Step 2: T detected - showing mock update v0.9.0');
    //         showUpdateIndicator('0.9.0');
    //         devKeySequence = [];
    //     } else if (!e.ctrlKey && !e.altKey)
    //     {
    //         // Reset sequence if user presses any other key combo
    //         if (devKeySequence.length > 0)
    //         {
    //             devKeySequence = [];
    //         }
    //     }
    // });
}

// Manual update check - resets the 4 hour timer
async function manualUpdateCheck()
{
    try
    {
        await runCombinedUpdateCheck({ manual: true, showProgress: true });
        localStorage.setItem('updateCheckTime', Date.now().toString());
    } catch (error)
    {
        console.error('Error during manual update check:', error);
        setStatusLine('App', 'Error checking for updates.');
        setStatusLine('Bindings', 'Error checking for updates.');
        renderCombinedStatus();
    }
}

