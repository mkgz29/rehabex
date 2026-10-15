import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { defaultLandingContent } from '../../lib/defaultContent';
import { hasSupabaseConfig } from '../../lib/supabase';
import { AdminApiError, getSettingVersion, saveHeroContent, syncHeroImages } from '../../services/adminApi';
import { getLandingContent } from '../../services/cms';
import type { HeroContent, HeroImage } from '../../types/cms';
import { heroImageToDraftItem, toHeroImagesPayload, type HeroGalleryDraftItem } from '../catalog/heroGallery';
import { AdminNotice } from '../components/AdminNotice';
import { FormActions } from '../components/FormActions';
import { FormField } from '../components/FormField';
import { HeroCarouselField } from '../components/HeroCarouselField';
import { useUnsavedChanges } from '../unsavedChanges/UnsavedChangesContext';

function messageForApiError(error: unknown, fallback: string) {
  if (error instanceof AdminApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

const CTA_DESTINATIONS = [
  { id: 'featured', label: 'Productos destacados', link: '#productos' },
  { id: 'store', label: 'Tienda', link: '/tienda' },
] as const;

type CtaDestinationId = (typeof CTA_DESTINATIONS)[number]['id'] | 'custom';
type AdminHeroPageProps = { onSaved?: (message: string) => void; onCancel?: () => void };

function destinationForLink(link: string): CtaDestinationId {
  const preset = CTA_DESTINATIONS.find((option) => option.link === link);
  return preset ? preset.id : 'custom';
}

export function AdminHeroPage({ onSaved, onCancel }: AdminHeroPageProps = {}) {
  const [heroContent, setHeroContent] = useState<HeroContent>(defaultLandingContent.hero);
  const [initialHeroContent, setInitialHeroContent] = useState<HeroContent>(defaultLandingContent.hero);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(null);
  const [carouselItems, setCarouselItems] = useState<HeroGalleryDraftItem[]>([]);
  const [initialCarouselItems, setInitialCarouselItems] = useState<HeroGalleryDraftItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { setDirty } = useUnsavedChanges();

  useEffect(() => {
    async function load() {
      try {
        const [content, version] = await Promise.all([getLandingContent(), getSettingVersion('hero_content')]);
        setHeroContent(content.hero);
        setInitialHeroContent(content.hero);
        setExpectedUpdatedAt(version);
        const draftImages = content.hero.images.map(heroImageToDraftItem);
        setCarouselItems(draftImages);
        setInitialCarouselItems(draftImages);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar la portada principal.');
      }
    }
    void load();
  }, []);

  const isDirty = JSON.stringify(heroContent) !== JSON.stringify(initialHeroContent) || JSON.stringify(carouselItems) !== JSON.stringify(initialCarouselItems);
  useEffect(() => setDirty('hero', isDirty), [isDirty, setDirty]);
  useEffect(() => () => setDirty('hero', false), [setDirty]);

  const updateHero = (field: keyof HeroContent, value: string) => {
    setHeroContent((current) => ({ ...current, [field]: value }));
  };

  const handleCancel = () => {
    setHeroContent(initialHeroContent);
    setCarouselItems(initialCarouselItems);
    setMessage(null);
    setError(null);
    setDirty('hero', false);
    onCancel?.();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    // Step 1: hero_content (text/CTA/eyebrow/single image). If this fails,
    // nothing was saved at all -- the carousel sync below is never
    // attempted, same as before.
    let saved: { content: Awaited<ReturnType<typeof saveHeroContent>>['content']; updatedAt: string };
    try {
      // No imageAssetId: the legacy single-image uploader was removed from
      // this page (FASE CMS admin-hero-carousel-only) -- heroContent.image_url/
      // image_framing are never edited here anymore, so there is never a
      // fresh upload to attach. Whatever value they already have on the
      // loaded heroContent flows through toHeroContentApiPayload unchanged,
      // which is exactly the "preserve the legacy fallback" requirement.
      saved = await saveHeroContent(heroContent, expectedUpdatedAt);
    } catch (contentError) {
      setError(messageForApiError(contentError, 'No se pudo guardar la portada principal.'));
      setSaving(false);
      return;
    }

    // The server never returns `images` (it isn't part of hero_content) --
    // carry over the carousel's current images rather than losing them from
    // the visible state. carouselItems/initialCarouselItems remain the real
    // source of truth for editing; this is only what HeroContent.images
    // reflects for anything that still reads it off this object.
    const contentWithImages: HeroContent = { ...saved.content, images: heroContent.images };
    setHeroContent(contentWithImages);
    setInitialHeroContent(contentWithImages);
    setExpectedUpdatedAt(saved.updatedAt);

    // Step 2: hero_images (the carousel), only if it actually changed. If
    // this fails, hero_content already committed -- say so explicitly
    // instead of implying nothing was saved.
    const carouselChanged = JSON.stringify(carouselItems) !== JSON.stringify(initialCarouselItems);
    if (carouselChanged) {
      try {
        const savedImages: HeroImage[] = await syncHeroImages(toHeroImagesPayload(carouselItems));
        const draftImages = savedImages.map(heroImageToDraftItem);
        setCarouselItems(draftImages);
        setInitialCarouselItems(draftImages);
      } catch {
        setError('El contenido se guardó, pero no pudimos actualizar las imágenes del carrusel. Intentá nuevamente.');
        setSaving(false);
        return;
      }
    }

    setDirty('hero', false);
    const savedMessage = 'Portada principal guardada correctamente.';
    setMessage(savedMessage);
    onSaved?.(savedMessage);
    setSaving(false);
  };

  const ctaDestination = destinationForLink(heroContent.primary_cta_link);

  return (
    <div className="space-y-5">
      {!hasSupabaseConfig ? (
        <AdminNotice>Esta sección no puede guardarse en este entorno. Probá nuevamente desde el entorno de administración habilitado.</AdminNotice>
      ) : null}
      {message ? <AdminNotice>{message}</AdminNotice> : null}
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}

      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="max-w-2xl space-y-4">
          <FormField label="Texto superior" hint="La línea pequeña arriba del título. Dejala vacía para no mostrarla.">
            <input type="text" value={heroContent.eyebrow} onChange={(event) => updateHero('eyebrow', event.target.value)} className="admin-input" />
          </FormField>
          <FormField label="Título principal" hint="Breve y fácil de leer sobre la imagen.">
            <input type="text" value={heroContent.title} onChange={(event) => updateHero('title', event.target.value)} className="admin-input" />
          </FormField>
          <FormField label="Descripción" hint="Opcional. Una sola frase corta.">
            <textarea value={heroContent.subtitle ?? ''} onChange={(event) => updateHero('subtitle', event.target.value)} rows={4} className="admin-input" />
          </FormField>
          <FormField label="Texto del botón">
            <input type="text" value={heroContent.primary_cta_text} onChange={(event) => updateHero('primary_cta_text', event.target.value)} className="admin-input" />
          </FormField>
          <FormField label="A dónde lleva el botón" hint="Elegí una sección de la tienda o escribí un enlace.">
            <select
              value={ctaDestination}
              onChange={(event) => {
                const next = event.target.value as CtaDestinationId;
                const preset = CTA_DESTINATIONS.find((option) => option.id === next);
                if (preset) updateHero('primary_cta_link', preset.link);
              }}
              className="admin-input"
            >
              {CTA_DESTINATIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              <option value="custom">Enlace personalizado</option>
            </select>
            {ctaDestination === 'custom' ? (
              <input
                type="text"
                value={heroContent.primary_cta_link}
                onChange={(event) => updateHero('primary_cta_link', event.target.value)}
                placeholder="Pegá o escribí el enlace completo"
                className="admin-input mt-3"
                aria-label="Enlace personalizado para el botón"
              />
            ) : null}
          </FormField>
        </div>
        <HeroCarouselField items={carouselItems} onChange={setCarouselItems} />
        <FormActions onCancel={handleCancel} saving={saving} sticky />
      </form>
    </div>
  );
}
