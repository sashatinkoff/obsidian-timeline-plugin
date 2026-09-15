const {
	Plugin,
	MarkdownRenderer,
	MarkdownRenderChild,
	PluginSettingTab,
	Setting,
	Modal,
	Notice,
	normalizePath,
} = require('obsidian');

const DEFAULT_SETTINGS = {
	mediaSize: 120,
	showMediaCaptions: true,
	autoDate: true,
	dateFormat: 'YYYY-MM-DD HH:mm',
	dateLocale: 'ru',
};

const BLOCK_LANGUAGE = 'track';

// ---------------------------------------------------------------------------
// Парсинг / сериализация
// ---------------------------------------------------------------------------

function trimTrailingEmptyLines(lines) {
	const out = lines.slice();
	while (out.length && out[out.length - 1].trim() === '') out.pop();
	return out;
}

function parseTimelineSource(source) {
	const lines = source.split('\n');
	let cardTitle = null;
	const entries = [];
	let current = null;

	const flushCurrent = () => {
		if (current) {
			current.bodyLines = trimTrailingEmptyLines(current.bodyLines);
			entries.push(current);
			current = null;
		}
	};

	for (const line of lines) {
		if (/^##\s/.test(line)) {
			cardTitle = line.replace(/^##\s+/, '').trim();
			continue;
		}
		if (/^####\s/.test(line)) {
			flushCurrent();
			entries.push({ type: 'section', label: line.replace(/^####\s+/, '').trim() });
			continue;
		}
		if (/^###\s/.test(line)) {
			flushCurrent();
			let title = line.replace(/^###\s+/, '').trim();
			let active = false;
			if (title.startsWith('!')) {
				active = true;
				title = title.slice(1).trim();
			}
			current = { type: 'event', title, date: null, bodyLines: [], active };
			continue;
		}
		if (current) {
			if (current.date === null) {
				// Строка сразу после заголовка события — это всегда дата (даже пустая)
				current.date = line.trim();
			} else {
				current.bodyLines.push(line);
			}
		}
	}
	flushCurrent();

	const eventEntries = entries.filter((e) => e.type === 'event');
	if (eventEntries.length > 0 && !eventEntries.some((e) => e.active)) {
		eventEntries[0].active = true;
	}

	return { cardTitle, entries };
}

function serializeTimeline(cardTitle, entries) {
	const lines = [];
	if (cardTitle && cardTitle.trim() !== '') {
		lines.push('## ' + cardTitle.trim());
		lines.push('');
	}
	entries.forEach((entry, idx) => {
		if (entry.type === 'section') {
			lines.push('#### ' + (entry.label || ''));
		} else {
			lines.push('### ' + (entry.active ? '!' : '') + (entry.title || ''));
			lines.push(entry.date || '');
			const body = (entry.bodyLines || []).join('\n');
			if (body.trim() !== '') {
				lines.push(...(entry.bodyLines || []));
			}
		}
		if (idx < entries.length - 1) lines.push('');
	});
	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Вспомогательные DOM-функции
// ---------------------------------------------------------------------------

function getAutoDateString(plugin) {
	const settings = plugin.settings || {};
	if (!settings.autoDate) return '';
	const format = settings.dateFormat || 'YYYY-MM-DD HH:mm';
	const locale = settings.dateLocale || 'ru';
	if (typeof window.moment === 'function') {
		try {
			return window.moment().locale(locale).format(format);
		} catch (e) {
			return window.moment().format(format);
		}
	}
	// На случай, если moment почему-то недоступен — простой запасной вариант.
	const d = new Date();
	const pad = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function autoResize(textarea) {
	textarea.style.height = 'auto';
	textarea.style.height = textarea.scrollHeight + 'px';
}

function makeEditableText(el, opts) {
	const value = opts.value;
	const placeholder = opts.placeholder;
	const onSave = opts.onSave;

	el.empty();
	if (!value) {
		el.addClass('tc-placeholder');
		el.setText(placeholder);
	} else {
		el.removeClass('tc-placeholder');
		el.setText(value);
	}

	el.addEventListener('click', () => {
		const input = document.createElement('input');
		input.type = 'text';
		input.className = 'tc-inline-input';
		input.value = value || '';
		el.replaceWith(input);
		input.focus();
		input.select();

		let done = false;
		const finish = (save) => {
			if (done) return;
			done = true;
			if (save && input.value.trim() !== value) {
				onSave(input.value);
				// Файл изменится → блок перерендерится автоматически.
			} else {
				input.replaceWith(el);
			}
		};
		input.addEventListener('blur', () => finish(true));
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				input.blur();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				finish(false);
			}
		});
	});
}

function wireInternalLinks(container, plugin, sourcePath) {
	const els = container.querySelectorAll('a.internal-link, .internal-embed');
	els.forEach((linkEl) => {
		linkEl.addEventListener('mouseover', (event) => {
			if (!(event.ctrlKey || event.metaKey)) return;
			const linktext =
				linkEl.getAttribute('href') ||
				linkEl.getAttribute('src') ||
				linkEl.getAttribute('data-href') ||
				'';
			plugin.app.workspace.trigger('hover-link', {
				event,
				source: 'timeline-card',
				hoverParent: container,
				targetEl: linkEl,
				linktext,
				sourcePath,
			});
		});
	});
}

function isMediaEmbed(el) {
	return (
		el.classList.contains('image-embed') ||
		el.classList.contains('video-embed') ||
		el.classList.contains('audio-embed') ||
		el.classList.contains('pdf-embed')
	);
}

function styleImportant(el, styles) {
	Object.keys(styles).forEach((prop) => el.style.setProperty(prop, styles[prop], 'important'));
}

// Принудительно задаёт размер самой картинке/видео внутри эмбеда.
// Делаем это через JS напрямую (не через CSS-селекторы), т.к. у CSS-правил
// с более специфичным селектором (например ".tc-media-grid img") приоритет
// выше, чем у ".tc-media-grid > *", и они перебивали наш размер.
function sizeMediaContent(embedEl) {
	const mediaEl = embedEl.querySelector('img, video, audio, iframe, canvas');
	if (!mediaEl) return false;
	mediaEl.removeAttribute('width');
	mediaEl.removeAttribute('height');
	styleImportant(mediaEl, {
		width: '100%',
		height: '100%',
		'max-width': '100%',
		'max-height': '100%',
		'object-fit': 'cover',
		display: 'block',
		margin: '0',
	});
	return true;
}

// Убирает узлы, которые визуально пусты (пробелы/переносы строк, пустые <p>,
// одиночные <br>), даже если formально у них остались дочерние элементы —
// именно такие "хвосты" от вырезанных эмбедов давали пустое место в карточке.
function removeVisuallyEmptyNodes(root) {
	Array.from(root.querySelectorAll('p, div')).forEach((node) => {
		const hasMedia = node.querySelector('img, video, audio, iframe, canvas, a');
		if (!hasMedia && node.textContent.trim() === '') {
			node.remove();
		}
	});
}

let activeLightbox = null;

function openLightbox(src, alt) {
	if (activeLightbox) activeLightbox.remove();
	const overlay = document.createElement('div');
	overlay.className = 'tc-lightbox-overlay';
	const img = document.createElement('img');
	img.src = src;
	img.alt = alt || '';
	img.className = 'tc-lightbox-img';
	overlay.appendChild(img);

	const close = () => {
		overlay.remove();
		document.removeEventListener('keydown', onKey);
		if (activeLightbox === overlay) activeLightbox = null;
	};
	const onKey = (e) => {
		if (e.key === 'Escape') close();
	};
	overlay.addEventListener('click', close);
	document.addEventListener('keydown', onKey);

	document.body.appendChild(overlay);
	activeLightbox = overlay;
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];

// Достаём из ИСХОДНОГО markdown-текста события синтаксис ![[картинка.png]]
// (с учётом ![[картинка.png|подпись]]) и заменяем каждое такое вхождение на
// текстовый токен-заглушку. Сам файл резолвим сразу через metadataCache —
// если файл найден и это картинка, рендерить её будем сами (см. buildMediaCell),
// а не через внутренний механизм эмбедов Obsidian.
//
// Это нужно, потому что у Obsidian асинхронная подгрузка эмбеда в режиме
// Live Preview иногда не успевает подставить саму картинку и оставляет под
// ней "запасной" текст с именем файла — эта проблема воспроизводится
// независимо от наших правок DOM. Рендеря <img> напрямую через
// vault.getResourcePath(), мы полностью убираем зависимость от этого
// внутреннего механизма для картинок. Видео/аудио/PDF всё ещё идут через
// обычный эмбед Obsidian (см. wrapNativeMediaEmbeds).
function extractImageEmbeds(bodyText, plugin, sourcePath) {
	const regex = /!\[\[([^\]]+?)\]\]/g;
	const embeds = [];
	let i = 0;
	const text = bodyText.replace(regex, (match, inner) => {
		const parts = inner.split('|');
		const linkPart = parts[0].trim();
		const ext = (linkPart.split('.').pop() || '').toLowerCase();
		if (!IMAGE_EXTENSIONS.includes(ext)) return match; // не картинка — оставляем Obsidian как есть
		const file = plugin.app.metadataCache.getFirstLinkpathDest(linkPart, sourcePath);
		if (!file) return match; // не нашли файл — пусть Obsidian покажет как обычно (заглушку)
		const token = 'zzztcmedia' + i + 'zzz';
		embeds.push({ token, file, alt: parts.slice(1).join('|').trim() || file.basename });
		i++;
		return token;
	});
	return { text, embeds };
}

function buildMediaCell(plugin, embedInfo) {
	const size = (plugin.settings && plugin.settings.mediaSize) || 120;
	const showCaptions = plugin.settings ? plugin.settings.showMediaCaptions !== false : true;
	const { file, alt } = embedInfo;

	const cell = document.createElement('div');
	cell.className = 'tc-media-cell';
	styleImportant(cell, {
		width: size + 'px',
		display: 'inline-flex',
		'flex-direction': 'column',
		'flex-shrink': '0',
		margin: '0',
	});

	const thumb = document.createElement('div');
	thumb.className = 'tc-media-thumb';
	styleImportant(thumb, {
		width: size + 'px',
		height: size + 'px',
		'min-width': size + 'px',
		'min-height': size + 'px',
		'max-width': size + 'px',
		'max-height': size + 'px',
		overflow: 'hidden',
		'border-radius': '8px',
		display: 'flex',
		'align-items': 'center',
		'justify-content': 'center',
		margin: '0',
		cursor: 'zoom-in',
		background: 'var(--background-secondary)',
	});

	const img = document.createElement('img');
	img.src = plugin.app.vault.getResourcePath(file);
	img.alt = alt;
	styleImportant(img, {
		width: '100%',
		height: '100%',
		'object-fit': 'cover',
		display: 'block',
		margin: '0',
	});
	thumb.appendChild(img);
	cell.appendChild(thumb);

	thumb.addEventListener('click', (e) => {
		e.stopPropagation();
		openLightbox(img.src, alt);
	});

	if (showCaptions) {
		const captionEl = document.createElement('div');
		captionEl.className = 'tc-media-caption';
		captionEl.textContent = alt;
		styleImportant(captionEl, {
			width: size + 'px',
			'max-width': size + 'px',
			'font-size': '0.75em',
			color: 'var(--text-muted)',
			'margin-top': '4px',
			overflow: 'hidden',
			'text-overflow': 'ellipsis',
			'white-space': 'nowrap',
			'text-align': 'center',
		});
		cell.appendChild(captionEl);
	}

	return cell;
}

// Ищет в уже отрендеренном DOM текстовые токены-заглушки и заменяет их на
// наши собственные карточки-миниатюры. Соседние миниатюры внутри одного
// абзаца группируются в общий горизонтальный ряд.
function insertMediaCells(root, embeds, plugin) {
	if (!embeds.length) return;
	const tokenMap = new Map(embeds.map((e) => [e.token, e]));
	const tokenRegex = /zzztcmedia(\d+)zzz/g;

	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const textNodes = [];
	let node;
	while ((node = walker.nextNode())) textNodes.push(node);

	textNodes.forEach((textNode) => {
		const text = textNode.nodeValue;
		if (!text.includes('zzztcmedia')) return;
		tokenRegex.lastIndex = 0;
		let match;
		let lastIndex = 0;
		const frag = document.createDocumentFragment();
		let any = false;
		while ((match = tokenRegex.exec(text))) {
			any = true;
			const before = text.slice(lastIndex, match.index);
			if (before) frag.appendChild(document.createTextNode(before));
			const embed = tokenMap.get(match[0]);
			if (embed) frag.appendChild(buildMediaCell(plugin, embed));
			lastIndex = tokenRegex.lastIndex;
		}
		if (!any) return;
		const rest = text.slice(lastIndex);
		if (rest) frag.appendChild(document.createTextNode(rest));
		textNode.parentNode.replaceChild(frag, textNode);
	});

	root.querySelectorAll('p').forEach((p) => {
		const cells = Array.from(p.querySelectorAll(':scope > .tc-media-cell'));
		if (!cells.length) return;
		p.classList.add('tc-media-grid');
		styleImportant(p, {
			display: 'flex',
			'flex-wrap': 'wrap',
			gap: '8px',
			'align-items': 'flex-start',
		});
		p.querySelectorAll(':scope > br').forEach((br) => br.remove());
	});

	removeVisuallyEmptyNodes(root);
}

// Оборачивает эмбед КВАДРАТНОЙ рамкой ровно на том же месте документа, где он
// и был отрендерен — без переноса в другой контейнер. Используется только для
// видео/аудио/PDF (и для картинок, которые почему-то не удалось резолвнуть
// заранее в extractImageEmbeds) — для остальных картинок разметку строим сами,
// см. extractImageEmbeds/buildMediaCell выше.
function wrapNativeMediaEmbeds(bodyEl, plugin) {
	const size = (plugin.settings && plugin.settings.mediaSize) || 120;
	const showCaptions = plugin.settings ? plugin.settings.showMediaCaptions !== false : true;

	const paragraphs = Array.from(bodyEl.querySelectorAll('p'));
	paragraphs.forEach((p) => {
		const embeds = Array.from(p.querySelectorAll('.internal-embed')).filter(isMediaEmbed);
		if (!embeds.length) return;

		p.classList.add('tc-media-grid');
		styleImportant(p, {
			display: 'flex',
			'flex-wrap': 'wrap',
			gap: '8px',
			'align-items': 'flex-start',
		});

		embeds.forEach((embedEl) => {
			embedEl.removeAttribute('width');
			embedEl.removeAttribute('height');
			embedEl.style.removeProperty('width');
			embedEl.style.removeProperty('height');

			const src = embedEl.getAttribute('src') || '';
			const alt = embedEl.getAttribute('alt') || '';
			const filename = src.split('/').pop() || '';
			const caption = alt && alt !== src ? alt : filename;

			const cell = document.createElement('div');
			cell.className = 'tc-media-cell';
			styleImportant(cell, {
				width: size + 'px',
				display: 'inline-flex',
				'flex-direction': 'column',
				'flex-shrink': '0',
				margin: '0',
			});

			const thumb = document.createElement('div');
			thumb.className = 'tc-media-thumb';
			styleImportant(thumb, {
				width: size + 'px',
				height: size + 'px',
				'min-width': size + 'px',
				'min-height': size + 'px',
				'max-width': size + 'px',
				'max-height': size + 'px',
				overflow: 'hidden',
				'border-radius': '8px',
				display: 'flex',
				'align-items': 'center',
				'justify-content': 'center',
				margin: '0',
				cursor: 'zoom-in',
				background: 'var(--background-secondary)',
			});

			// Вставляем cell ровно на место эмбеда (тот же родитель-абзац),
			// затем перемещаем эмбед на один уровень глубже, внутрь thumb —
			// эмбед никогда не покидает свой исходный абзац.
			embedEl.parentNode.insertBefore(cell, embedEl);
			thumb.appendChild(embedEl);
			cell.appendChild(thumb);

			thumb.addEventListener('click', (e) => {
				e.stopPropagation();
				const mediaImg = embedEl.querySelector('img');
				if (mediaImg) openLightbox(mediaImg.currentSrc || mediaImg.src, mediaImg.alt || caption);
			});

			if (showCaptions && caption) {
				const captionEl = document.createElement('div');
				captionEl.className = 'tc-media-caption';
				captionEl.textContent = caption;
				styleImportant(captionEl, {
					width: size + 'px',
					'max-width': size + 'px',
					'font-size': '0.75em',
					color: 'var(--text-muted)',
					'margin-top': '4px',
					overflow: 'hidden',
					'text-overflow': 'ellipsis',
					'white-space': 'nowrap',
					'text-align': 'center',
				});
				cell.appendChild(captionEl);
			}

			// Картинка внутри эмбеда у Obsidian иногда появляется не сразу
			// (асинхронная подгрузка) — подстрахуемся наблюдателем.
			if (!sizeMediaContent(embedEl)) {
				const observer = new MutationObserver(() => {
					if (sizeMediaContent(embedEl)) observer.disconnect();
				});
				observer.observe(embedEl, { childList: true, subtree: true });
				setTimeout(() => observer.disconnect(), 5000);
			}
		});
	});

	removeVisuallyEmptyNodes(bodyEl);
}

function setupCollapse(bodyEl) {
	const grids = Array.from(bodyEl.querySelectorAll(':scope > .tc-media-grid'));
	const otherNodes = Array.from(bodyEl.childNodes).filter((node) => !grids.includes(node));

	const hasRealContent = otherNodes.some((node) => {
		if (node.nodeType === Node.TEXT_NODE) return node.textContent.trim() !== '';
		return (
			node.textContent.trim() !== '' ||
			(node.querySelector && node.querySelector('img, video, audio, iframe, canvas, a'))
		);
	});

	if (!hasRealContent) {
		// Текста нет — только медиа. Убираем пустые узлы, обёртку сворачивания
		// не создаём (иначе она оставляет пустое место сверху).
		otherNodes.forEach((node) => node.remove());
		grids.forEach((g) => g.style.setProperty('margin-top', '0px', 'important'));
		return;
	}

	// Собираем "текстовые" узлы в одну обёртку-на-месте-первого-из-них,
	// сохраняя относительный порядок с рядами медиа.
	const wrapper = document.createElement('div');
	wrapper.className = 'tc-collapsible';
	const firstOther = otherNodes[0];
	if (firstOther && firstOther.parentNode) {
		firstOther.parentNode.insertBefore(wrapper, firstOther);
	} else {
		bodyEl.insertBefore(wrapper, bodyEl.firstChild);
	}
	otherNodes.forEach((node) => wrapper.appendChild(node));

	requestAnimationFrame(() => {
		if (wrapper.scrollHeight > wrapper.clientHeight + 4) {
			wrapper.classList.add('tc-clamped');
			const toggle = document.createElement('div');
			toggle.className = 'tc-toggle';
			toggle.textContent = 'Показать полностью';
			toggle.addEventListener('click', (e) => {
				e.stopPropagation();
				const clamped = wrapper.classList.toggle('tc-clamped');
				toggle.textContent = clamped ? 'Показать полностью' : 'Свернуть';
			});
			wrapper.parentNode.insertBefore(toggle, wrapper.nextSibling);
		}
	});
}

// Простой автокомплит [[ — своя реализация, т.к. публичного API для вставки
// suggester'а в произвольный textarea у Obsidian нет.
function attachLinkSuggest(textarea, plugin) {
	let dropdown = null;

	function closeDropdown() {
		if (dropdown) {
			dropdown.remove();
			dropdown = null;
		}
	}

	function getQueryContext() {
		const pos = textarea.selectionStart;
		const value = textarea.value.slice(0, pos);
		const match = /\[\[([^\]\[\n]*)$/.exec(value);
		if (!match) return null;
		return { query: match[1], start: pos - match[1].length };
	}

	function getCandidates(query) {
		const q = query.toLowerCase();
		return plugin.app.vault
			.getFiles()
			.map((f) => {
				const path = f.path.toLowerCase();
				const base = f.basename.toLowerCase();
				let score = -1;
				if (q === '') score = 0;
				else if (base.startsWith(q)) score = 2;
				else if (path.includes(q)) score = 1;
				return { f, score };
			})
			.filter((x) => x.score >= 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, 20)
			.map((x) => x.f);
	}

	function selectItem(items, idx) {
		items.forEach((it) => it.classList.remove('is-selected'));
		items[idx].classList.add('is-selected');
	}

	function choose(file, ctxRange) {
		const isMedia = file.extension && file.extension.toLowerCase() !== 'md';
		const insertText = isMedia ? '![[' + file.path + ']]' : '[[' + file.basename + ']]';
		const before = textarea.value.slice(0, ctxRange.start - 2); // убираем "[["
		const after = textarea.value.slice(textarea.selectionStart);
		textarea.value = before + insertText + after;
		const cursorPos = (before + insertText).length;
		textarea.setSelectionRange(cursorPos, cursorPos);
		closeDropdown();
		autoResize(textarea);
		textarea.focus();
	}

	function openDropdown(candidates, ctxRange) {
		closeDropdown();
		if (!candidates.length) return;
		dropdown = document.createElement('div');
		dropdown.className = 'tc-suggest-dropdown';
		candidates.forEach((file, i) => {
			const row = document.createElement('div');
			row.className = 'tc-suggest-item' + (i === 0 ? ' is-selected' : '');
			row.textContent = file.path;
			row.addEventListener('mousedown', (e) => {
				e.preventDefault(); // не даём textarea потерять фокус
				choose(file, ctxRange);
			});
			dropdown.appendChild(row);
		});
		const rect = textarea.getBoundingClientRect();
		dropdown.style.left = rect.left + window.scrollX + 'px';
		dropdown.style.top = rect.bottom + window.scrollY + 'px';
		dropdown.style.width = Math.max(220, Math.min(rect.width, 360)) + 'px';
		document.body.appendChild(dropdown);
	}

	textarea.addEventListener('input', () => {
		const ctxRange = getQueryContext();
		if (!ctxRange) {
			closeDropdown();
			return;
		}
		openDropdown(getCandidates(ctxRange.query), ctxRange);
	});

	textarea.addEventListener('keydown', (e) => {
		if (!dropdown) return;
		const items = Array.from(dropdown.children);
		let idx = items.findIndex((i) => i.classList.contains('is-selected'));
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectItem(items, (idx + 1) % items.length);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectItem(items, (idx - 1 + items.length) % items.length);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const sel = items[idx];
			if (sel) sel.dispatchEvent(new MouseEvent('mousedown'));
		} else if (e.key === 'Escape') {
			closeDropdown();
		}
	});

	textarea.addEventListener('blur', () => setTimeout(closeDropdown, 150));

	Object.defineProperty(textarea, '_tcSuggestOpen', {
		get: () => !!dropdown,
		configurable: true,
	});
}

// ---------------------------------------------------------------------------
// Плагин
// ---------------------------------------------------------------------------

module.exports = class TimelineCardPlugin extends Plugin {
	async onload() {
		await this.loadSettings();
		this.addSettingTab(new TimelineCardSettingTab(this.app, this));

		// Все сейчас отображённые карточки — чтобы мгновенно перерисовать их
		// при изменении настроек (иначе обновление ждало бы правки заметки).
		this.activeRenders = new Set();

		this.addCommand({
			id: 'insert-timeline-card',
			name: 'Вставить Timeline Card',
			editorCallback: (editor) => {
				const date = getAutoDateString(this);
				const template = '```track\n## Новая карточка\n\n### !Первое событие\n' + date + '\n\n```\n';
				editor.replaceSelection(template);
			},
		});

		this.registerMarkdownCodeBlockProcessor(BLOCK_LANGUAGE, (source, el, ctx) => {
			const state = parseTimelineSource(source);
			const entry = { el, ctx, state };
			this.activeRenders.add(entry);

			const child = new MarkdownRenderChild(el);
			child.onunload = () => this.activeRenders.delete(entry);
			ctx.addChild(child);

			this.renderCard(state, el, ctx);
		});
	}

	refreshAllRenders() {
		this.activeRenders.forEach((entry) => {
			if (!entry.el.isConnected) {
				this.activeRenders.delete(entry);
				return;
			}
			this.renderCard(entry.state, entry.el, entry.ctx);
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async commitState(state, el, ctx) {
		const section = ctx.getSectionInfo(el);
		if (!section) return;
		const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
		if (!file) return;

		const newInner = serializeTimeline(state.cardTitle, state.entries);

		const transform = (data) => {
			const lines = data.split('\n');
			const openFence = lines[section.lineStart];
			const closeFence = lines[section.lineEnd];
			const before = lines.slice(0, section.lineStart);
			const after = lines.slice(section.lineEnd + 1);
			const rebuilt = [openFence, ...newInner.split('\n'), closeFence];
			return [...before, ...rebuilt, ...after].join('\n');
		};

		if (this.app.vault.process) {
			await this.app.vault.process(file, transform);
		} else {
			const data = await this.app.vault.read(file);
			await this.app.vault.modify(file, transform(data));
		}
	}

	renderCard(state, el, ctx) {
		el.empty();
		const plugin = this;
		const commit = () => plugin.commitState(state, el, ctx);

		const card = el.createDiv({ cls: 'tc-card' });

		const titleEl = card.createDiv({ cls: 'tc-card-title' });
		makeEditableText(titleEl, {
			value: state.cardTitle || '',
			placeholder: 'Заголовок карточки (необязательно)',
			onSave: (v) => {
				state.cardTitle = v.trim();
				commit();
			},
		});

		const list = card.createDiv({ cls: 'tc-list' });

		state.entries.forEach((entry, idx) => {
			if (entry.type === 'section') {
				const row = list.createDiv({ cls: 'tc-section' });

				const labelEl = row.createDiv({ cls: 'tc-section-label' });
				makeEditableText(labelEl, {
					value: entry.label || '',
					placeholder: 'Название секции',
					onSave: (v) => {
						entry.label = v.trim();
						commit();
					},
				});

				const delBtn = row.createDiv({ cls: 'tc-delete-btn tc-section-delete' });
				delBtn.setText('✕');
				delBtn.setAttr('aria-label', 'Удалить секцию');
				delBtn.addEventListener('click', () => {
					state.entries.splice(idx, 1);
					commit();
				});
				return;
			}

			// entry.type === 'event'
			const nextEntry = state.entries[idx + 1];
			const showLine = !!(nextEntry && nextEntry.type === 'event');

			const row = list.createDiv({
				cls: 'tc-item' + (entry.active ? ' tc-item-active' : ''),
			});

			const marker = row.createDiv({ cls: 'tc-marker' });
			const dot = marker.createDiv({ cls: 'tc-dot' });
			dot.setAttr('aria-label', 'Сделать текущим статусом');
			dot.addEventListener('click', () => {
				state.entries.forEach((e) => {
					if (e.type === 'event') e.active = false;
				});
				entry.active = true;
				commit();
			});
			if (showLine) marker.createDiv({ cls: 'tc-line' });

			const content = row.createDiv({ cls: 'tc-content' });

			const titleField = content.createDiv({ cls: 'tc-title' });
			makeEditableText(titleField, {
				value: entry.title || '',
				placeholder: 'Название события',
				onSave: (v) => {
					entry.title = v.trim();
					commit();
				},
			});

			const dateField = content.createDiv({ cls: 'tc-date' });
			makeEditableText(dateField, {
				value: entry.date || '',
				placeholder: 'Дата',
				onSave: (v) => {
					entry.date = v.trim();
					commit();
				},
			});

			const bodyContainer = content.createDiv({ cls: 'tc-body-container' });
			plugin.renderBody(bodyContainer, entry, ctx, commit);

			const delBtn = content.createDiv({ cls: 'tc-delete-btn' });
			delBtn.setText('✕');
			delBtn.setAttr('aria-label', 'Удалить событие');
			delBtn.addEventListener('click', () => {
				state.entries.splice(idx, 1);
				commit();
			});
		});

		const addRow = card.createDiv({ cls: 'tc-add-row' });

		const addEventBtn = addRow.createDiv({ cls: 'tc-add-btn' });
		addEventBtn.setText('+ Добавить событие');
		addEventBtn.addEventListener('click', () => {
			state.entries.push({
				type: 'event',
				title: '',
				date: getAutoDateString(plugin),
				bodyLines: [],
				active: false,
			});
			commit();
		});

		const addSectionBtn = addRow.createDiv({ cls: 'tc-add-btn tc-add-section-btn' });
		addSectionBtn.setText('+ Добавить секцию');
		addSectionBtn.addEventListener('click', () => {
			state.entries.push({ type: 'section', label: '' });
			commit();
		});
	}

	renderBody(container, item, ctx, commit) {
		const plugin = this;
		container.empty();
		const bodyText = (item.bodyLines || []).join('\n');

		if (bodyText.trim() === '') {
			const empty = container.createDiv({ cls: 'tc-body-add' });
			empty.setText('+ Добавить описание');
			empty.addEventListener('click', () => plugin.enterBodyEdit(container, item, ctx, commit));
			return;
		}

		const { text: processedText, embeds } = extractImageEmbeds(bodyText, plugin, ctx.sourcePath);

		const viewEl = container.createDiv({ cls: 'tc-body' });
		MarkdownRenderer.renderMarkdown(processedText, viewEl, ctx.sourcePath, plugin).then(() => {
			wireInternalLinks(viewEl, plugin, ctx.sourcePath);
			insertMediaCells(viewEl, embeds, plugin);
			wrapNativeMediaEmbeds(viewEl, plugin);
			setupCollapse(viewEl);
		});

		viewEl.addEventListener('click', (evt) => {
			if (
				evt.target.closest('a') ||
				evt.target.closest('.tc-media-grid') ||
				evt.target.closest('.tc-toggle')
			) {
				return;
			}
			plugin.enterBodyEdit(container, item, ctx, commit);
		});
	}

	enterBodyEdit(container, item, ctx, commit) {
		const plugin = this;
		container.empty();
		const textarea = container.createEl('textarea', { cls: 'tc-body-edit' });
		textarea.value = (item.bodyLines || []).join('\n');
		autoResize(textarea);
		setTimeout(() => textarea.focus(), 0);

		attachLinkSuggest(textarea, plugin);

		const finish = () => {
			item.bodyLines = textarea.value.split('\n');
			commit();
		};

		textarea.addEventListener('input', () => autoResize(textarea));
		textarea.addEventListener('blur', () => {
			setTimeout(() => {
				if (!textarea._tcSuggestOpen) finish();
			}, 120);
		});
		textarea.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				plugin.renderBody(container, item, ctx, commit);
			}
		});
	}
};

class ReadmeModal extends Modal {
	constructor(app, plugin, content) {
		super(app);
		this.plugin = plugin;
		this.content = content;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('tc-readme-modal');
		this.titleEl.setText('Timeline Card — README');
		MarkdownRenderer.renderMarkdown(this.content, contentEl, '', this.plugin);
	}

	onClose() {
		this.contentEl.empty();
	}
}

class TimelineCardSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Timeline Card' });

		new Setting(containerEl)
			.setName('README')
			.setDesc('Синтаксис блока, все возможности и ограничения плагина.')
			.addButton((btn) =>
				btn.setButtonText('Открыть README').onClick(async () => {
					try {
						const path = normalizePath(this.plugin.manifest.dir + '/README.md');
						const content = await this.plugin.app.vault.adapter.read(path);
						new ReadmeModal(this.plugin.app, this.plugin, content).open();
					} catch (e) {
						new Notice('Не удалось прочитать README.md: ' + e.message);
					}
				})
			);

		new Setting(containerEl)
			.setName('Размер медиа-миниатюр (px)')
			.setDesc('Ширина и высота блоков для встроенных изображений/видео в карточках.')
			.addText((text) =>
				text
					.setPlaceholder('120')
					.setValue(String(this.plugin.settings.mediaSize))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						this.plugin.settings.mediaSize = isNaN(num) ? 120 : num;
						await this.plugin.saveSettings();
						this.plugin.refreshAllRenders();
					})
			);

		new Setting(containerEl)
			.setName('Показывать описание в карточках медиа')
			.setDesc('Под каждой миниатюрой будет показано имя файла (или alt-текст, если он задан).')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showMediaCaptions !== false).onChange(async (value) => {
					this.plugin.settings.showMediaCaptions = value;
					await this.plugin.saveSettings();
					this.plugin.refreshAllRenders();
				})
			);

		containerEl.createEl('h3', { text: 'Дата события' });

		new Setting(containerEl)
			.setName('Автоматически подставлять дату')
			.setDesc('При нажатии «+ Добавить событие» поле даты сразу заполняется текущей датой/временем.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoDate !== false).onChange(async (value) => {
					this.plugin.settings.autoDate = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Формат даты')
			.setDesc(
				'Формат в нотации moment.js. YYYY — год, MM — месяц, DD — день, HH — часы (24ч), mm — минуты. Например: YYYY-MM-DD HH:mm.'
			)
			.addText((text) =>
				text
					.setPlaceholder('YYYY-MM-DD HH:mm')
					.setValue(this.plugin.settings.dateFormat)
					.onChange(async (value) => {
						this.plugin.settings.dateFormat = value.trim() || 'YYYY-MM-DD HH:mm';
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Язык даты')
			.setDesc('Код локали moment.js: ru, en, de и т.п. Влияет на названия месяцев/дней, если они есть в формате.')
			.addText((text) =>
				text
					.setPlaceholder('ru')
					.setValue(this.plugin.settings.dateLocale)
					.onChange(async (value) => {
						this.plugin.settings.dateLocale = value.trim() || 'ru';
						await this.plugin.saveSettings();
					})
			);
	}
}
