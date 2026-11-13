import { domToPng } from 'modern-screenshot';

// Freeze already-decoded media; cloning a live MJPEG <img> would open another stream.
export async function capturePreviewFrame(root: HTMLElement): Promise<string> {
  const media = [...root.querySelectorAll<HTMLImageElement | HTMLVideoElement>('img,video')];
  const replacements = new Map<string, HTMLImageElement>();
  const markers: HTMLElement[] = [];
  try {
    for (const [index, source] of media.entries()) {
      const canvas = document.createElement('canvas');
      canvas.width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
      canvas.height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
      const image = new Image();
      image.alt = '';
      const style = getComputedStyle(source);
      for (const property of style) image.style.setProperty(property, style.getPropertyValue(property));
      if (canvas.width && canvas.height) {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('The browser cannot capture a 3D preview frame.');
        context.drawImage(source, 0, 0);
        image.src = canvas.toDataURL();
      }
      const key = String(index), marker = document.createElement('span');
      marker.hidden = true;
      marker.dataset.previewFrameMedia = key;
      source.before(marker);
      markers.push(marker);
      replacements.set(key, image);
    }
    return await domToPng(root, {
      width: root.clientWidth, height: root.clientHeight, scale: 1, font: false, timeout: 3000,
      features: { restoreScrollPosition: true },
      filter: node => !(node instanceof HTMLImageElement || node instanceof HTMLVideoElement),
      onCloneNode: clone => {
        if (!(clone instanceof HTMLElement)) throw new Error('The preview frame could not be cloned.');
        for (const marker of clone.querySelectorAll<HTMLElement>('[data-preview-frame-media]')) {
          const image = replacements.get(marker.dataset.previewFrameMedia!);
          if (image) marker.replaceWith(image);
        }
      },
    });
  } finally {
    markers.forEach(marker => marker.remove());
  }
}
