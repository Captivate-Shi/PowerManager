type Box = Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>;

function align(token: string | undefined, spare: number) {
  if (!token || token === 'center') return spare / 2;
  if (token.endsWith('%')) return spare * Number.parseFloat(token) / 100;
  if (token === 'left' || token === 'top') return 0;
  if (token === 'right' || token === 'bottom') return spare;
  const pixels = Number.parseFloat(token);
  return Number.isFinite(pixels) ? pixels : spare / 2;
}

export function containedImage(image: HTMLImageElement, aspect = image.naturalWidth / image.naturalHeight): Box {
  const box = image.getBoundingClientRect();
  const width = Math.min(box.width, box.height * aspect);
  const height = width / aspect;
  const [x, y] = getComputedStyle(image).objectPosition.split(/\s+/);
  return { x: box.x + align(x, box.width - width), y: box.y + align(y, box.height - height), width, height };
}

type Photo = { image: HTMLImageElement; box: Box; clip: string; feather: string; edge: string; opacity: number; filter: string };

function readPhoto(image: HTMLImageElement, aspect: number): Photo | undefined {
  const box = containedImage(image, aspect);
  if (box.width < 2 || box.height < 2) return;
  const frame = image.closest('[data-list-artwork]');
  const layer = image.closest('[data-list-art-layer], [data-active-stage]');
  const style = getComputedStyle(layer ?? image);
  const opacity = Number(style.opacity);
  if (!frame) return { image, box, clip: 'inset(0% 0% 0% 0%)', feather: '100%', edge: '100%', opacity, filter: style.filter };
  const matte = frame.getBoundingClientRect();
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  const fraction = (x: number) => (x - box.x) / box.width * 100;
  const visibleLeft = clamp(fraction(Math.max(0, matte.left)));
  const visibleRight = clamp(fraction(Math.min(innerWidth, matte.right)));
  const top = clamp((matte.top - box.y) / box.height * 100);
  const bottom = clamp((box.y + box.height - matte.bottom) / box.height * 100);
  if (visibleRight <= visibleLeft || top + bottom >= 100) return;
  // The window already clips the left side. A cut attached to the image
  // would travel into the window and slice through the grip.
  return { image, box, clip: `inset(${top}% ${100 - visibleRight}% ${bottom}% 0%)`,
    feather: clamp(fraction(matte.left + matte.width * .78)) + '%', edge: visibleRight + '%',
    opacity: opacity * Number(getComputedStyle(frame).opacity), filter: style.filter };
}

export function animateDetailPhoto(origin: Photo, to: HTMLImageElement, duration: number) {
  const from = origin.image;
  const src = from.currentSrc || from.src;
  if (src !== (to.currentSrc || to.src)) return;
  const target = readPhoto(to, from.naturalWidth / from.naturalHeight);
  if (!target) return;
  const { box } = target;
  const proxy = new Image();
  proxy.src = src;
  proxy.alt = '';
  proxy.setAttribute('aria-hidden', 'true');
  proxy.dataset.detailPhotoFlight = '';
  Object.assign(proxy.style, { left: box.x + 'px', top: box.y + 'px', width: box.width + 'px', height: box.height + 'px' });
  to.dataset.detailPhotoHidden = '';
  document.body.append(proxy);
  const keyframe = (photo: Photo): Keyframe => ({
    transform: `translate(${photo.box.x - box.x}px, ${photo.box.y - box.y}px) scale(${photo.box.width / box.width})`,
    clipPath: photo.clip, opacity: photo.opacity, filter: photo.filter,
    '--detail-feather': photo.feather, '--detail-edge': photo.edge,
  });
  const animation = proxy.animate([keyframe(origin), keyframe(target)], {
    duration, easing: 'cubic-bezier(.22,.72,.24,1)', fill: 'both',
  });
  const cleanup = () => {
    animation.cancel();
    proxy.remove();
    delete to.dataset.detailPhotoHidden;
  };
  return { finished: animation.finished, cleanup };
}

export function detailPhoto(image?: HTMLImageElement) {
  if (!image?.naturalWidth || !image.naturalHeight) return;
  return readPhoto(image, image.naturalWidth / image.naturalHeight);
}

export function stageReflection(scope?: Element | null) {
  return scope?.querySelector<HTMLElement>('[data-active-stage] [data-device-reflection]') ?? undefined;
}

export function freezeReflection(layer?: HTMLElement) {
  if (!layer) return;
  const box = layer.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const copy = layer.cloneNode(false) as HTMLElement;
  copy.dataset.reflectionExit = '';
  delete copy.dataset.reflectionEntering;
  Object.assign(copy.style, {
    position: 'fixed', inset: 'auto', left: box.x + 'px', top: box.y + 'px',
    width: box.width + 'px', height: box.height + 'px', opacity: getComputedStyle(layer).opacity,
  });
  return copy;
}

export function fadeReflection(layer: HTMLElement, entering: boolean, duration: number, delay = 0) {
  if (entering) layer.dataset.reflectionEntering = '';
  else document.body.append(layer);
  const animation = layer.animate(
    entering ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: Number(layer.style.opacity) }, { opacity: 0 }],
    { duration, delay, fill: 'both', easing: 'ease-in-out' },
  );
  const cleanup = () => {
    animation.cancel();
    if (entering) delete layer.dataset.reflectionEntering;
    else layer.remove();
  };
  return { finished: animation.finished, cleanup };
}
