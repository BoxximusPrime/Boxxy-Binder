// Character Manager Module
// Manages SC character appearance backups and deployments

const { invoke } = window.__TAURI__.core;
const { open } = window.__TAURI__.dialog;

class CharacterManager
{
    constructor()
    {
        this.libraryPath = null;
        this.installations = [];
        this.activeInstallation = null;
        this.masterCharacters = [];
        this.installationCharacters = {};

        this.init();
    }

    async init()
    {
        // Load saved library path
        this.libraryPath = localStorage.getItem('characterLibraryPath');

        if (this.libraryPath)
        {
            this.updateLibraryPathDisplay();
        }

        await this.reloadCharacterData();

        // Setup event listeners
        this.setupEventListeners();

        // Listen for storage changes to refresh when SC directory is set
        window.addEventListener('storage', (e) =>
        {
            if (e.key === 'scInstallDirectory')
            {
                this.loadInstallations();
            }
        });
    }

    setupEventListeners()
    {
        // Set Library Path button
        document.getElementById('set-library-path-btn')?.addEventListener('click', async () =>
        {
            await this.selectLibraryPath();
        });

        // Refresh All button
        document.getElementById('refresh-characters-btn')?.addEventListener('click', async () =>
        {
            await this.refreshAll();
        });

        // Reload data when character tab is clicked
        const characterTab = document.getElementById('tab-character');
        if (characterTab)
        {
            characterTab.addEventListener('click', async () =>
            {
                await this.reloadCharacterData();
            });
        }

        // Reload data when page becomes visible (user returns from settings page)
        document.addEventListener('visibilitychange', () =>
        {
            if (!document.hidden)
            {
                this.reloadCharacterData();
            }
        });
    }

    async reloadCharacterData()
    {
        await this.loadMasterCharacters();
        await this.loadInstallations();

        if (this.activeInstallation)
        {
            this.renderInstallationContent(this.activeInstallation);
        }
    }

    async refreshAll()
    {
        this.showNotification('Refreshing character data...', 'info');

        try
        {
            await this.reloadCharacterData();

            this.showSuccess('Character data refreshed successfully');
        } catch (error)
        {
            console.error('Error refreshing character data:', error);
            this.showError('Failed to refresh character data: ' + error);
        }
    }

    async selectLibraryPath()
    {
        try
        {
            const selectedPath = await open({
                directory: true,
                multiple: false,
                title: 'Select Character Library Directory'
            });

            if (selectedPath)
            {
                this.libraryPath = selectedPath;
                localStorage.setItem('characterLibraryPath', selectedPath);
                this.updateLibraryPathDisplay();
                await this.loadMasterCharacters();
                // Refresh installation characters to update sync status
                for (const installation of this.installations)
                {
                    await this.loadInstallationCharacters(installation);
                }
                if (this.activeInstallation)
                {
                    this.renderInstallationContent(this.activeInstallation);
                }
                this.renderMasterCharacters();
            }
        } catch (error)
        {
            console.error('Error selecting library path:', error);
            this.showError('Failed to select library path: ' + error);
        }
    }

    updateLibraryPathDisplay()
    {
        const pathValueEl = document.getElementById('library-path-value');
        if (pathValueEl)
        {
            if (this.libraryPath)
            {
                pathValueEl.textContent = this.libraryPath;
                pathValueEl.classList.remove('empty');
            } else
            {
                pathValueEl.textContent = 'Not configured';
                pathValueEl.classList.add('empty');
            }
        }
    }

    updateCharacterCounts()
    {
        const masterCount = this.masterCharacters.length;
        const installationCount = this.installations.length;
        const installedCount = Object.values(this.installationCharacters)
            .reduce((total, characters) => total + characters.length, 0);

        this.setText('master-character-count', masterCount);
        this.setText('installation-count', installationCount);
        this.setText('installed-character-count', installedCount);
        this.setText('master-character-count-inline', `${masterCount} ${masterCount === 1 ? 'file' : 'files'}`);
        this.setText('installation-count-inline', `${installationCount} ${installationCount === 1 ? 'install' : 'installs'}`);
    }

    setText(id, value)
    {
        const element = document.getElementById(id);
        if (element)
        {
            element.textContent = value;
        }
    }

    async loadMasterCharacters()
    {
        if (!this.libraryPath)
        {
            this.renderEmptyMasterLibrary();
            return;
        }

        try
        {
            const characters = await invoke('scan_character_files', {
                directoryPath: this.libraryPath
            });

            this.masterCharacters = characters;
            this.updateCharacterCounts();
            this.renderMasterCharacters();
        } catch (error)
        {
            console.error('Error loading master characters:', error);
            this.renderEmptyMasterLibrary('Error loading characters: ' + error);
        }
    }

    async loadInstallations()
    {
        const scDirectory = localStorage.getItem('scInstallDirectory');
        if (!scDirectory)
        {
            this.installations = [];
            this.installationCharacters = {};
            this.updateCharacterCounts();
            this.renderEmptyInstallations('not-configured');
            return;
        }

        try
        {
            const installations = await invoke('scan_sc_installations', {
                basePath: scDirectory
            });

            this.installations = installations;
            this.installationCharacters = installations.reduce((accumulator, installation) =>
            {
                accumulator[installation.name] = this.installationCharacters[installation.name] || [];
                return accumulator;
            }, {});
            this.updateCharacterCounts();

            if (installations.length > 0)
            {
                // Load characters for each installation
                for (const install of installations)
                {
                    await this.loadInstallationCharacters(install);
                }

                this.updateCharacterCounts();

                this.renderInstallationTabs();

                // Activate first installation by default
                if (this.installations.length > 0)
                {
                    this.switchInstallation(this.installations[0].name);
                }
            } else
            {
                this.renderEmptyInstallations();
            }
        } catch (error)
        {
            console.error('Error loading installations:', error);
            this.renderEmptyInstallations('Error loading installations: ' + error);
        }
    }

    async loadInstallationCharacters(installation)
    {
        try
        {
            // Character path: INSTALL\user\client\0\customcharacters\
            const characterPath = `${installation.path}\\user\\client\\0\\customcharacters`;

            const characters = await invoke('scan_character_files', {
                directoryPath: characterPath
            });

            this.installationCharacters[installation.name] = characters;
            this.updateCharacterCounts();
        } catch (error)
        {
            console.error(`Error loading characters for ${installation.name}:`, error);
            this.installationCharacters[installation.name] = [];
            this.updateCharacterCounts();
        }
    }

    renderMasterCharacters()
    {
        const listEl = document.getElementById('master-characters-list');
        if (!listEl) return;

        if (this.masterCharacters.length === 0)
        {
            this.updateCharacterCounts();
            listEl.innerHTML = `
        <div class="empty-state">
                    <div class="empty-state-icon">CHF</div>
          <h3>No Characters Found</h3>
          <p>No .chf files found in the library directory</p>
        </div>
      `;
            return;
        }

        this.updateCharacterCounts();

        listEl.innerHTML = this.masterCharacters.slice().sort((a, b) => a.name.localeCompare(b.name)).map(char =>
        {
            const syncStatus = this.getMasterCharacterSyncStatus(char);
            const hasNewerVersion = this.hasNewerVersionInInstallations(char);

            return `
            <div class="character-card">
                <div class="character-icon">CHF</div>
                <div class="character-info">
                    <h4 class="character-name">${char.name}</h4>
                    <div class="character-meta-row">
                        ${syncStatus ? `<div class="character-line character-sync-status">${syncStatus}</div>` : ''}
                        <div class="character-line character-meta">
                            <span class="character-date">Modified ${this.formatDate(char.modified)}</span>
                        </div>
                    </div>
                </div>
                <div class="character-actions">
                    ${hasNewerVersion ? `
                        <button class="btn btn-primary btn-sm" onclick="characterManager.updateFromNewest('${char.name}')" title="Update library with newest version">
                            Save Newest
                        </button>
                    ` : ''}
                    <button class="btn btn-secondary btn-sm" onclick="characterManager.exportCharacter('${char.name}')" title="Export to all installations">
                        Send to Installs
                    </button>
                    <button class="btn btn-danger btn-sm btn-delete" onclick="characterManager.deleteCharacter('${char.name}')" title="Delete from library">
                        Delete
                    </button>
                </div>
            </div>
        `;
        }).join('');
    }

    hasNewerVersionInInstallations(masterChar)
    {
        for (const [installName, characters] of Object.entries(this.installationCharacters))
        {
            const installChar = characters.find(c => c.name === masterChar.name);
            if (installChar && installChar.modified > masterChar.modified)
            {
                return true;
            }
        }
        return false;
    }

    async updateFromNewest(characterName)
    {
        if (!this.libraryPath)
        {
            this.showError('Library path not configured');
            return;
        }

        try
        {
            // Find the newest version across all installations
            let newestVersion = null;
            let newestInstallation = null;
            let newestTimestamp = 0;

            for (const [installName, characters] of Object.entries(this.installationCharacters))
            {
                const installChar = characters.find(c => c.name === characterName);
                if (installChar && installChar.modified > newestTimestamp)
                {
                    newestVersion = installChar;
                    newestInstallation = this.installations.find(i => i.name === installName);
                    newestTimestamp = installChar.modified;
                }
            }

            if (!newestVersion || !newestInstallation)
            {
                this.showError('No newer version found in installations');
                return;
            }

            // Import the newest version to library
            await invoke('import_character_to_library', {
                characterName,
                installationPath: newestInstallation.path,
                libraryPath: this.libraryPath
            });

            this.showSuccess(`Updated ${characterName} in library from ${newestInstallation.name} (${this.formatDate(newestTimestamp)})`);

            // Reload master characters to reflect the update
            await this.loadMasterCharacters();

            // Optionally refresh the current installation view if it's active
            if (this.activeInstallation)
            {
                const activeInstall = this.installations.find(i => i.name === this.activeInstallation);
                if (activeInstall)
                {
                    await this.loadInstallationCharacters(activeInstall);
                    this.renderInstallationContent(this.activeInstallation);
                }
            }
        } catch (error)
        {
            console.error('Error updating from newest version:', error);
            this.showError('Failed to update from newest version: ' + error);
        }
    }

    getMasterCharacterSyncStatus(masterChar)
    {
        const statuses = [];
        const newerInInstallations = [];
        const outdatedInInstallations = [];
        const missingInInstallations = [];

        // Check each installation for this character
        for (const [installName, characters] of Object.entries(this.installationCharacters))
        {
            const installChar = characters.find(c => c.name === masterChar.name);

            if (!installChar)
            {
                missingInInstallations.push(installName);
            } else if (installChar.modified > masterChar.modified)
            {
                newerInInstallations.push(installName);
            } else if (installChar.modified < masterChar.modified)
            {
                outdatedInInstallations.push(installName);
            }
        }

        // Build status message
        if (newerInInstallations.length > 0)
        {
            statuses.push(`<span class="sync-status-newer">Newer in ${this.formatInstallationList(newerInInstallations)}</span>`);
        }
        if (outdatedInInstallations.length > 0)
        {
            statuses.push(`<span class="sync-status-outdated">Library newer than ${this.formatInstallationList(outdatedInInstallations)}</span>`);
        }
        if (missingInInstallations.length > 0)
        {
            statuses.push(`<span class="sync-status-missing">Missing in ${this.formatInstallationList(missingInInstallations)}</span>`);
        }

        return statuses.length > 0 ? statuses.join(' ') : null;
    }

    formatInstallationList(installNames)
    {
        return installNames.join('/');
    }

    renderEmptyMasterLibrary(message = null)
    {
        const listEl = document.getElementById('master-characters-list');
        if (!listEl) return;

        this.updateCharacterCounts();

        listEl.innerHTML = `
      <div class="empty-state">
                <div class="empty-state-icon">CHF</div>
        <h3>${message || 'No Character Library'}</h3>
        <p>${message ? '' : 'Set a library path to start managing your character appearances'}</p>
      </div>
    `;
    }

    renderInstallationTabs()
    {
        const tabsEl = document.getElementById('installation-tabs');
        if (!tabsEl) return;

        if (this.installations.length === 0)
        {
            this.updateCharacterCounts();
            this.renderEmptyInstallations();
            return;
        }

        const installationIcons = {
            'LIVE': '🌟',
            'PTU': '🧪',
            'EPTU': '🔬',
            'TECH-PREVIEW': '⚡',
            'HOTFIX': '🩹'
        };

        this.updateCharacterCounts();

        tabsEl.innerHTML = this.installations.map(install => `
      <button class="installation-tab" data-install="${install.name}">
                <span class="installation-tab-icon">${installationIcons[install.name] || 'SC'}</span>
                <span class="installation-tab-main">${install.name}</span>
                <span class="installation-tab-count">${(this.installationCharacters[install.name] || []).length}</span>
      </button>
    `).join('');

        // Add click listeners
        tabsEl.querySelectorAll('.installation-tab').forEach(tab =>
        {
            tab.addEventListener('click', () =>
            {
                const installName = tab.dataset.install;
                this.switchInstallation(installName);
            });
        });
    }

    renderEmptyInstallations(message = null)
    {
        const tabsEl = document.getElementById('installation-tabs');
        const contentEl = document.getElementById('installation-content');

        this.updateCharacterCounts();

        if (tabsEl)
        {
            if (message === 'not-configured')
            {
                tabsEl.innerHTML = `
          <div class="empty-state">
                        <div class="empty-state-icon">SC</div>
            <h3>Star Citizen Installation Not Configured</h3>
            <p>To manage character appearances across installations, you need to configure your Star Citizen installation directory.</p>
            <button class="btn btn-primary" onclick="window.switchTab('settings')" style="margin-top: 1rem;">
              Go to Settings
            </button>
          </div>
        `;
            }
            else
            {
                tabsEl.innerHTML = `
          <div class="empty-state">
                        <div class="empty-state-icon">SC</div>
            <h3>${message || 'No Installations Found'}</h3>
            <p>${message ? '' : 'Configure your SC directory in Settings to detect installations'}</p>
          </div>
        `;
            }
        }

        if (contentEl)
        {
            contentEl.innerHTML = '';
        }
    }

    switchInstallation(installName)
    {
        this.activeInstallation = installName;

        // Update active tab
        document.querySelectorAll('.installation-tab').forEach(tab =>
        {
            if (tab.dataset.install === installName)
            {
                tab.classList.add('active');
            } else
            {
                tab.classList.remove('active');
            }
        });

        // Render installation content
        this.renderInstallationContent(installName);
    }

    renderInstallationContent(installName)
    {
        const contentEl = document.getElementById('installation-content');
        if (!contentEl) return;

        const installation = this.installations.find(i => i.name === installName);
        if (!installation) return;

        const characters = this.installationCharacters[installName] || [];
        const displayCharacters = this.getInstallationDisplayCharacters(installName);

        contentEl.innerHTML = `
      <div class="installation-panel active">
        <div class="installation-header">
                    <div class="installation-header-copy">
                        <span class="section-kicker">Selected Install</span>
                        <h4>${installName}</h4>
            <div class="installation-path">${installation.path}</div>
          </div>
                    <div class="installation-header-meta">
                        <span>${characters.length} local ${characters.length === 1 ? 'character' : 'characters'}</span>
                        <span>${this.masterCharacters.length} in library</span>
                    </div>
          <button class="btn btn-primary" onclick="characterManager.deployAllToInstallation('${installName}')">
                        Restore All from Library
          </button>
        </div>

        ${displayCharacters.length === 0 ? `
          <div class="empty-state">
                        <div class="empty-state-icon">CHF</div>
            <h3>No Characters Found</h3>
            <p>No character files in this installation</p>
          </div>
        ` : `
          <div class="installation-characters-list">
            ${displayCharacters.map(char => this.renderInstallationCharacter(char, installName)).join('')}
          </div>
        `}
      </div>
    `;
    }

    getInstallationDisplayCharacters(installName)
    {
        const installationCharacters = this.installationCharacters[installName] || [];
        const installCharacterNames = new Set(installationCharacters.map(char => char.name));

        const missingLibraryCharacters = this.masterCharacters
            .filter(char => !installCharacterNames.has(char.name))
            .map(char => ({
                ...char,
                isMissingFromInstallation: true
            }));

        return [...installationCharacters, ...missingLibraryCharacters]
            .sort((a, b) =>
            {
                if (!!a.isMissingFromInstallation !== !!b.isMissingFromInstallation)
                {
                    return a.isMissingFromInstallation ? 1 : -1;
                }

                return a.name.localeCompare(b.name);
            });
    }

    renderInstallationCharacter(char, installName)
    {
        if (char.isMissingFromInstallation)
        {
            return `
            <div class="character-card character-card-missing-install">
                <div class="character-icon">CHF</div>
                <div class="character-info">
                    <h4 class="character-name">${char.name}</h4>
                    <div class="character-meta-row">
                        <div class="character-line character-status-row">
                            <span class="character-status missing">Missing in Install</span>
                        </div>
                        <div class="character-line character-meta">
                            <span class="character-date">Available in library</span>
                        </div>
                    </div>
                </div>
                <div class="character-actions">
                    <button class="btn btn-primary btn-sm" onclick="characterManager.deployToInstallation('${char.name}', '${installName}')" title="Restore from library">
                        Import
                    </button>
                </div>
            </div>
        `;
        }

        const masterChar = this.masterCharacters.find(m => m.name === char.name);

        let status = 'missing';
        let statusText = 'Not in Library';

        if (masterChar)
        {
            if (char.modified === masterChar.modified)
            {
                status = 'up-to-date';
                statusText = 'Up to Date';
            } else if (char.modified > masterChar.modified)
            {
                status = 'newer';
                statusText = 'Newer';
            } else
            {
                status = 'outdated';
                statusText = 'Outdated';
            }
        }

        return `
            <div class="character-card">
                <div class="character-icon">CHF</div>
                <div class="character-info">
                    <h4 class="character-name">${char.name}</h4>
                    <div class="character-meta-row">
                        <div class="character-line character-status-row">
                            <span class="character-status ${status}">${statusText}</span>
                        </div>
                        <div class="character-line character-meta">
                            <span class="character-date">Modified ${this.formatDate(char.modified)}</span>
                        </div>
                    </div>
                </div>
                <div class="character-actions">
                    ${status === 'newer' || status === 'missing' ? `
                        <button class="btn btn-primary btn-sm" onclick="characterManager.importToLibrary('${char.name}', '${installName}')" title="Import to library">
                            Save to Library
                        </button>
                    ` : ''}
                    ${masterChar ? `
                        <button class="btn btn-secondary btn-sm" onclick="characterManager.deployToInstallation('${char.name}', '${installName}')" title="Deploy from library">
                            Restore
                        </button>
                    ` : ''}
                    <button class="btn btn-danger btn-sm btn-delete" onclick="characterManager.deleteFromInstallation('${char.name}', '${installName}')" title="Delete from installation">
                        Delete
                    </button>
                </div>
            </div>
        `;
    }

    async deployToInstallation(characterName, installName)
    {
        if (!this.libraryPath)
        {
            this.showError('Library path not configured');
            return;
        }

        const installation = this.installations.find(i => i.name === installName);
        if (!installation)
        {
            this.showError('Installation not found');
            return;
        }

        try
        {
            await invoke('deploy_character_to_installation', {
                characterName,
                libraryPath: this.libraryPath,
                installationPath: installation.path
            });

            this.showSuccess(`Deployed ${characterName} to ${installName}`);
            await this.loadInstallationCharacters(installation);
            this.renderInstallationContent(installName);
        } catch (error)
        {
            console.error('Error deploying character:', error);
            this.showError('Failed to deploy character: ' + error);
        }
    }

    async deployAllToInstallation(installName)
    {
        if (!this.libraryPath || this.masterCharacters.length === 0)
        {
            this.showError('No characters in library to deploy');
            return;
        }

        const installation = this.installations.find(i => i.name === installName);
        if (!installation)
        {
            this.showError('Installation not found');
            return;
        }

        try
        {
            for (const char of this.masterCharacters)
            {
                await invoke('deploy_character_to_installation', {
                    characterName: char.name,
                    libraryPath: this.libraryPath,
                    installationPath: installation.path
                });
            }

            this.showSuccess(`Deployed all characters to ${installName}`);
            await this.loadInstallationCharacters(installation);
            this.renderInstallationContent(installName);
        } catch (error)
        {
            console.error('Error deploying all characters:', error);
            this.showError('Failed to deploy all characters: ' + error);
        }
    }

    async importToLibrary(characterName, installName)
    {
        if (!this.libraryPath)
        {
            this.showError('Library path not configured');
            return;
        }

        const installation = this.installations.find(i => i.name === installName);
        if (!installation)
        {
            this.showError('Installation not found');
            return;
        }

        try
        {
            await invoke('import_character_to_library', {
                characterName,
                installationPath: installation.path,
                libraryPath: this.libraryPath
            });

            this.showSuccess(`Imported ${characterName} to library`);
            await this.loadMasterCharacters();
            await this.loadInstallationCharacters(installation);
            this.renderInstallationContent(installName);
        } catch (error)
        {
            console.error('Error importing character:', error);
            this.showError('Failed to import character: ' + error);
        }
    }

    async exportCharacter(characterName)
    {
        if (!this.libraryPath)
        {
            this.showError('Library path not configured');
            return;
        }

        if (this.installations.length === 0)
        {
            this.showError('No installations found');
            return;
        }

        try
        {
            for (const installation of this.installations)
            {
                await invoke('deploy_character_to_installation', {
                    characterName,
                    libraryPath: this.libraryPath,
                    installationPath: installation.path
                });
            }

            this.showSuccess(`Deployed ${characterName} to all installations`);

            // Reload all installation characters
            for (const installation of this.installations)
            {
                await this.loadInstallationCharacters(installation);
            }

            // Re-render master characters to update sync status
            this.renderMasterCharacters();

            if (this.activeInstallation)
            {
                this.renderInstallationContent(this.activeInstallation);
            }
        } catch (error)
        {
            console.error('Error exporting character:', error);
            this.showError('Failed to export character: ' + error);
        }
    }

    async deleteCharacter(characterName)
    {
        if (!this.libraryPath)
        {
            this.showError('Library path not configured');
            return;
        }

        // Use showConfirmation from main.js (available globally via window)
        const showConfirmation = window.showConfirmation;
        if (!showConfirmation)
        {
            this.showError('Confirmation dialog not available');
            return;
        }

        const confirmed = await showConfirmation(
            `Delete "${characterName}" from your library?\n\nThis will NOT delete it from your game installations.`,
            'Delete Character',
            'Delete',
            'Cancel',
            'btn-danger'
        );

        if (!confirmed)
        {
            return;
        }

        try
        {
            await invoke('delete_character_from_library', {
                characterName,
                libraryPath: this.libraryPath
            });

            this.showSuccess(`Deleted ${characterName} from library`);
            await this.loadMasterCharacters();
        } catch (error)
        {
            console.error('Error deleting character:', error);
            this.showError('Failed to delete character: ' + error);
        }
    }

    async deleteFromInstallation(characterName, installName)
    {
        const installation = this.installations.find(i => i.name === installName);
        if (!installation)
        {
            this.showError('Installation not found');
            return;
        }

        // Use showConfirmation from main.js (available globally via window)
        const showConfirmation = window.showConfirmation;
        if (!showConfirmation)
        {
            this.showError('Confirmation dialog not available');
            return;
        }

        const confirmed = await showConfirmation(
            `Delete "${characterName}" from ${installName}?`,
            'Delete Character',
            'Delete',
            'Cancel',
            'btn-danger'
        );

        if (!confirmed)
        {
            return;
        }

        try
        {
            await invoke('delete_character_from_installation', {
                installationPath: installation.path,
                characterName
            });

            this.showSuccess(`Character "${characterName}" deleted from ${installName}`);
            await this.loadInstallationCharacters(installation);
            this.renderInstallationContent(installName);
            this.renderMasterCharacters();
        } catch (error)
        {
            console.error('Error deleting character from installation:', error);
            this.showError(`Error deleting character: ${error}`);
        }
    }

    formatDate(timestamp)
    {
        const numericTimestamp = Number(timestamp);
        if (!Number.isFinite(numericTimestamp))
        {
            return 'Unknown';
        }

        const timestampMs = numericTimestamp < 1000000000000
            ? numericTimestamp * 1000
            : numericTimestamp;

        const date = new Date(timestampMs);
        if (Number.isNaN(date.getTime()))
        {
            return 'Unknown';
        }

        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    formatFileSize(bytes)
    {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    showSuccess(message)
    {
        this.showNotification(message, 'success');
    }

    showError(message)
    {
        this.showNotification(message, 'error');
    }

    showNotification(message, type = 'info')
    {
        // Use global toast system if available
        if (window.toast)
        {
            switch (type)
            {
                case 'success':
                    window.toast.success(message);
                    break;
                case 'error':
                    window.toast.error(message);
                    break;
                default:
                    window.toast.info(message);
            }
            return;
        }

        // Fallback: Create notification element
        const notification = document.createElement('div');
        notification.className = `character-notification character-notification-${type}`;

        const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
        notification.innerHTML = `
            <span class="notification-icon">${icon}</span>
            <span class="notification-message">${message}</span>
            <button class="notification-close" onclick="this.parentElement.remove()">×</button>
        `;

        // Add to page
        document.body.appendChild(notification);

        // Auto-remove after 5 seconds
        setTimeout(() =>
        {
            if (notification.parentElement)
            {
                notification.remove();
            }
        }, 5000);
    }
}

// Initialize character manager when on the character tab
let characterManager = null;

// Export initialization function for main.js to call
window.initCharacterManager = function ()
{
    if (!characterManager)
    {
        characterManager = new CharacterManager();
        window.characterManager = characterManager;
    }
};

// Listen for tab changes
document.addEventListener('DOMContentLoaded', () =>
{
    const characterTab = document.getElementById('tab-character');

    if (characterTab)
    {
        characterTab.addEventListener('click', () =>
        {
            window.initCharacterManager();
        });
    }
});
