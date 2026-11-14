import { BATCH_SIZE } from './model.js';
import { imageBlob } from './storage.js';

export function batches(images) {
  return Array.from({ length: Math.ceil(images.length / BATCH_SIZE) }, (_, index) => {
    const items = images.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE);
    return { index, items, completed: items.filter((image) => image.reviewed).length };
  });
}

export class BatchCache {
  constructor(read = imageBlob, urls = URL) {
    this.read = read;
    this.urls = urls;
    this.entries = new Map();
    this.key = '';
    this.generation = 0;
  }

  clear() {
    this.generation += 1;
    for (const item of this.entries.values()) if (item.url) this.urls.revokeObjectURL(item.url);
    this.entries.clear();
    this.key = '';
  }

  async load(images, update) {
    if (images.length > BATCH_SIZE) throw new Error('O cache aceita somente um lote de 100 imagens.');
    const key = images.map((image) => image.src).join('|');
    if (this.key === key) return;
    this.clear();
    this.key = key;
    const generation = this.generation;
    // Sequencial para não manter cem leituras/decodificações simultâneas.
    for (const image of images) {
      if (generation !== this.generation) return;
      if (this.entries.has(image.src)) continue;
      try {
        const blob = await this.read(image.src);
        if (generation !== this.generation) return;
        this.entries.set(image.src, { url: this.urls.createObjectURL(blob) });
      } catch (error) {
        if (generation !== this.generation) return;
        this.entries.set(image.src, { error: error.message });
      }
      update();
    }
  }
}
