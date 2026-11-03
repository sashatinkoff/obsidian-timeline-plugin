'use strict';

const { Modal } = require('obsidian');

class ConfirmModal extends Modal {
  constructor(app, { title, message, confirmText = 'Удалить', danger = true, onConfirm }) {
    super(app);
    this.opts = { title, message, confirmText, danger, onConfirm };
  }
  onOpen() {
    const { title, message, confirmText, danger, onConfirm } = this.opts;
    this.titleEl.setText(title);
    this.contentEl.createEl('p', { text: message });
    const row = this.contentEl.createDiv({ cls: 'modal-button-container' });
    row.createEl('button', { text: 'Отмена' }).addEventListener('click', () => this.close());
    const ok = row.createEl('button', { text: confirmText, cls: danger ? 'mod-warning' : 'mod-cta' });
    ok.addEventListener('click', () => { this.close(); onConfirm(); });
  }
  onClose() {
    this.contentEl.empty();
  }
}

function confirm(app, opts) {
  return new Promise((resolve) => {
    const modal = new ConfirmModal(app, { ...opts, onConfirm: () => resolve(true) });
    const origClose = modal.onClose.bind(modal);
    modal.onClose = () => { origClose(); setTimeout(() => resolve(false), 0); };
    modal.open();
  });
}

module.exports = { ConfirmModal, confirm };
