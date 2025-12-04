// frontend/app.js

class App {
    constructor() {
        this.historyList = document.getElementById('history-list');
        this.searchInput = document.getElementById('search-input');
        this.settingsBtn = document.getElementById('settings-btn');
        this.filterFavBtn = document.getElementById('filter-fav-btn');

        // Preview elements
        this.previewTooltip = document.getElementById('preview-tooltip');
        this.previewContent = document.getElementById('preview-content');

        // Settings page elements
        this.backBtn = document.getElementById('back-btn');
        this.notificationsToggle = document.getElementById('notifications-toggle');
        this.darkModeToggle = document.getElementById('dark-mode-toggle');
        this.aiTaggingToggle = document.getElementById('ai-tagging-toggle');
        this.apiKeyInput = document.getElementById('api-key');

        this.showFavoritesOnly = false;

        this.init();
    }

    async init() {
        window.addEventListener('pywebviewready', async () => {
            console.log('pywebview ready');
            if (this.historyList) {
                await this.loadHistory();
                this.setupMainListeners();
            } else if (this.backBtn) {
                await this.loadSettings();
                this.setupSettingsListeners();
            }
        });
    }

    setupMainListeners() {
        if (this.searchInput) {
            this.searchInput.addEventListener('input', () => this.loadHistory());
        }
        if (this.settingsBtn) {
            this.settingsBtn.addEventListener('click', () => {
                window.location.href = 'settings.html';
            });
        }
        if (this.filterFavBtn) {
            this.filterFavBtn.addEventListener('click', () => {
                this.showFavoritesOnly = !this.showFavoritesOnly;
                this.updateFilterBtnState();
                this.loadHistory();
            });
        }
    }

    updateFilterBtnState() {
        if (this.showFavoritesOnly) {
            this.filterFavBtn.classList.add('text-primary', 'bg-primary/10');
            this.filterFavBtn.classList.remove('text-icon-light', 'bg-zinc-200/50', 'dark:text-icon-dark', 'dark:bg-zinc-700/50');
            this.filterFavBtn.querySelector('span').classList.add('fill-1');
        } else {
            this.filterFavBtn.classList.remove('text-primary', 'bg-primary/10');
            this.filterFavBtn.classList.add('text-icon-light', 'bg-zinc-200/50', 'dark:text-icon-dark', 'dark:bg-zinc-700/50');
            this.filterFavBtn.querySelector('span').classList.remove('fill-1');
        }
    }

    setupSettingsListeners() {
        if (this.backBtn) {
            this.backBtn.addEventListener('click', () => {
                this.saveSettings().then(() => {
                    window.location.href = 'index.html';
                });
            });
        }

        // Auto-save on change for toggles
        const inputs = [this.notificationsToggle, this.darkModeToggle, this.aiTaggingToggle, this.apiKeyInput];
        inputs.forEach(input => {
            if (input) {
                input.addEventListener('change', () => this.saveSettings());
            }
        });
    }

    async loadHistory() {
        const query = this.searchInput ? this.searchInput.value : '';
        const filter = this.showFavoritesOnly ? 'Favorites ★' : 'All Types';

        try {
            const history = await window.pywebview.api.get_history(filter, query);
            this.renderHistory(history);
        } catch (error) {
            console.error('Failed to load history:', error);
        }
    }

    renderHistory(history) {
        if (!this.historyList) return;

        this.historyList.innerHTML = '';

        if (history.length === 0) {
            this.historyList.innerHTML = `
                <div class="flex-1 flex-col items-center justify-center space-y-4 p-8 text-center">
                    <div class="flex h-20 w-20 items-center justify-center rounded-full bg-card-light dark:bg-card-dark mx-auto">
                        <span class="material-symbols-outlined text-4xl text-text-secondary-light dark:text-text-secondary-dark">content_paste_off</span>
                    </div>
                    <div class="space-y-1">
                        <h3 class="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark">No items found</h3>
                        <p class="text-sm text-text-secondary-light dark:text-text-secondary-dark">Try adjusting your search or filters.</p>
                    </div>
                </div>
            `;
            return;
        }

        history.forEach(item => {
            const el = document.createElement('div');
            el.className = 'group flex items-center gap-3 rounded-xl bg-card-light p-3 shadow-sm transition-all hover:shadow-md dark:bg-card-dark cursor-default';

            let contentHtml = '';
            let icon = 'description'; // default text icon
            let previewText = item.preview || item.content || '';

            if (item.data_type === 'IMAGE') {
                icon = 'image';
                const thumbSrc = item.thumbnail_path ? item.thumbnail_path.replace(/\\/g, '/') : '';
                const safeThumbSrc = thumbSrc.startsWith('http') || thumbSrc.startsWith('file') ? thumbSrc : `file:///${thumbSrc}`;

                contentHtml = `
                    <div class="flex flex-col">
                        ${thumbSrc ? `<img src="${safeThumbSrc}" alt="Thumbnail" class="mt-1 h-24 w-auto rounded-lg object-cover border border-slate-200 dark:border-slate-700">` : ''}
                    </div>
                `;
                previewText = '[Image Content]';
            } else if (item.data_type === 'FILES') {
                icon = 'folder';
                contentHtml = `<p class="line-clamp-4 break-all text-sm font-medium text-text-primary-light dark:text-text-primary-dark">${this.escapeHtml(item.preview || 'Files')}</p>`;
            } else {
                contentHtml = `<p class="line-clamp-4 break-all text-sm font-medium text-text-primary-light dark:text-text-primary-dark">${this.escapeHtml(item.preview || item.content)}</p>`;
            }

            const timeAgo = 'Just now';

            el.innerHTML = `
                <div class="flex flex-1 items-start gap-3 overflow-hidden">
                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background-light dark:bg-background-dark mt-1">
                        <span class="material-symbols-outlined text-xl text-text-primary-light dark:text-text-primary-dark">${icon}</span>
                    </div>
                    <div class="flex min-w-0 flex-1 flex-col justify-center">
                        ${contentHtml}
                    </div>
                </div>
                <div class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 self-start mt-1">
                    <button class="btn-favorite flex h-8 w-8 items-center justify-center rounded-full ${item.is_favorite ? 'text-primary' : 'text-text-secondary-light dark:text-text-secondary-dark'} hover:bg-zinc-100 dark:hover:bg-zinc-700">
                        <span class="material-symbols-outlined text-xl ${item.is_favorite ? 'fill-1' : ''}">star</span>
                    </button>
                    <button class="btn-delete flex h-8 w-8 items-center justify-center rounded-full text-text-secondary-light dark:text-text-secondary-dark hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-900/30 dark:hover:text-red-400">
                        <span class="material-symbols-outlined text-xl">delete</span>
                    </button>
                </div>
            `;

            // Force favorite button visible if favorite
            if (item.is_favorite) {
                el.querySelector('.opacity-0').classList.remove('opacity-0');
            }

            // Event listeners
            el.querySelector('.btn-favorite').addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleFavorite(item.id);
            });
            el.querySelector('.btn-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteItem(item.id);
            });
            el.addEventListener('dblclick', () => this.pasteItem(item.id));

            // Hover Preview Logic
            el.addEventListener('mouseenter', (e) => {
                this.previewTimeout = setTimeout(() => {
                    this.showPreview(e, item);
                }, 800); // 800ms delay
            });
            el.addEventListener('mouseleave', () => {
                clearTimeout(this.previewTimeout);
                this.hidePreview();
            });
            el.addEventListener('mousemove', (e) => this.movePreview(e));

            this.historyList.appendChild(el);
        });
    }

    showPreview(e, item) {
        if (!this.previewTooltip || !this.previewContent) return;

        let content = item.content;
        if (item.data_type === 'FILES') {
            content = item.content; // Already a list of files
        } else if (item.data_type === 'IMAGE') {
            // Maybe show image dimensions or path?
            content = `Image: ${item.content}`;
        }

        if (!content || content.length < 50) return; // Don't show preview for short text

        this.previewContent.textContent = content.substring(0, 1000) + (content.length > 1000 ? '...' : '');
        this.previewTooltip.classList.remove('hidden');
        this.movePreview(e);
    }

    hidePreview() {
        if (this.previewTooltip) {
            this.previewTooltip.classList.add('hidden');
        }
    }

    movePreview(e) {
        if (!this.previewTooltip || this.previewTooltip.classList.contains('hidden')) return;

        const x = e.clientX + 20;
        const y = e.clientY + 20;

        // Boundary checks could be added here to keep tooltip on screen
        // Simple check to prevent going off right edge
        if (x + 300 > window.innerWidth) {
            this.previewTooltip.style.left = `${x - 320}px`;
        } else {
            this.previewTooltip.style.left = `${x}px`;
        }

        // Simple check for bottom edge
        if (y + 200 > window.innerHeight) {
            this.previewTooltip.style.top = `${y - 200}px`;
        } else {
            this.previewTooltip.style.top = `${y}px`;
        }
    }

    async toggleFavorite(id) {
        await window.pywebview.api.toggle_favorite(id);
        await this.loadHistory();
    }

    async deleteItem(id) {
        if (confirm('Are you sure you want to delete this item?')) {
            await window.pywebview.api.delete_item(id);
            await this.loadHistory();
        }
    }

    async pasteItem(id) {
        await window.pywebview.api.paste_item(id);
    }

    async loadSettings() {
        try {
            const settings = await window.pywebview.api.get_settings();
            if (this.notificationsToggle) this.notificationsToggle.checked = settings.notifications !== false; // Default true
            // if (this.darkModeToggle) this.darkModeToggle.checked = settings.dark_mode; // Need to implement dark mode logic in backend or JS
            if (this.aiTaggingToggle) this.aiTaggingToggle.checked = settings.enable_ai_tagging;
            if (this.apiKeyInput) this.apiKeyInput.value = settings.ai_api_key || '';
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }

    async saveSettings() {
        const settings = {
            notifications: this.notificationsToggle ? this.notificationsToggle.checked : true,
            // dark_mode: this.darkModeToggle ? this.darkModeToggle.checked : false,
            enable_ai_tagging: this.aiTaggingToggle ? this.aiTaggingToggle.checked : false,
            ai_api_key: this.apiKeyInput ? this.apiKeyInput.value : ''
        };

        try {
            // We need to merge with existing settings to avoid overwriting other keys
            const currentSettings = await window.pywebview.api.get_settings();
            const newSettings = { ...currentSettings, ...settings };
            await window.pywebview.api.save_settings(newSettings);
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

const app = new App();
window.app = app;
