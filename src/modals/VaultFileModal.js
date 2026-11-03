'use strict';

const { FuzzySuggestModal } = require('obsidian');

/** Выбор существующего файла хранилища (медиа/документа) для прикрепления к событию. */
class VaultFileModal extends FuzzySuggestModal {
  constructor(app, onChoose, filter) {
    super(app);
    this.onChoose = onChoose;
    this.filter = filter || ((f) => f.extension !== 'md' && f.extension !== 'canvas');
    this.setPlaceholder('Найдите файл в хранилище…');
  }
  getItems() {
    return this.app.vault.getFiles().filter(this.filter).sort((a, b) => b.stat.mtime - a.stat.mtime);
  }
  getItemText(file) {
    return file.path;
  }
  onChooseItem(file) {
    this.onChoose(file);
  }
}

module.exports = { VaultFileModal };
