"use client";

import { upload } from "@vercel/blob/client";
import {
  Clipboard,
  ExternalLink,
  ImagePlus,
  Loader2,
  Star,
  Trash2,
  UploadCloud,
  X,
  ZoomIn,
} from "lucide-react";
import { type ChangeEvent, type DragEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";

export type ProductImageInput = {
  url: string;
  alt: string;
  isPrimary: boolean;
};

type ImageItem = ProductImageInput & {
  id: string;
  name: string;
  progress?: number;
  uploading?: boolean;
  localPreview?: string;
};

type ProductImageUploaderProps = {
  value: ProductImageInput[];
  onChange: (images: ProductImageInput[]) => void;
  maxImages?: number;
};

const MAX_IMAGES = 12;
const MAX_IMAGE_DIMENSION = 1600;
const WEBP_QUALITY = 0.84;
const OPTIMIZE_THRESHOLD = 450 * 1024;

export function ProductImageUploader({
  value,
  onChange,
  maxImages = MAX_IMAGES,
}: ProductImageUploaderProps) {
  const [items, setItems] = useState<ImageItem[]>(
    value.map((image, index) => ({
      ...image,
      id: image.url + "-" + index,
      name: "Imagen",
    })),
  );
  const [dragActive, setDragActive] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ImageItem | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function emit(next: ImageItem[]) {
    setItems(next);
    onChange(
      next
        .filter((item) => item.url && !item.uploading)
        .map(({ url, alt, isPrimary }) => ({ url, alt, isPrimary })),
    );
  }

  function ensurePrimary(next: ImageItem[]) {
    const primaryIndex = next.findIndex((item) => item.isPrimary);
    return next.map((item, index) => ({
      ...item,
      isPrimary: primaryIndex >= 0 ? index === primaryIndex : index === 0,
    }));
  }

  async function optimizeImage(file: File): Promise<File> {
    // Keep animated GIFs intact. Other supported images are converted to WebP
    // when it reduces bandwidth or the source image needs resizing.
    if (file.type === "image/gif") return file;

    const objectUrl = URL.createObjectURL(file);

    try {
      const image = new Image();

      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("No pudimos leer la imagen."));
        image.src = objectUrl;
      });

      const largestSide = Math.max(image.naturalWidth, image.naturalHeight);
      const needsResize = largestSide > MAX_IMAGE_DIMENSION;
      const needsCompression = file.size > OPTIMIZE_THRESHOLD;

      if (!needsResize && !needsCompression && file.type === "image/webp") {
        return file;
      }

      const scale = needsResize ? MAX_IMAGE_DIMENSION / largestSide : 1;
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");
      if (!context) return file;

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", WEBP_QUALITY),
      );

      if (!blob || blob.size >= file.size) return file;

      return new File(
        [blob],
        file.name.replace(/\.[^.]+$/, "") + ".webp",
        {
          type: "image/webp",
          lastModified: Date.now(),
        },
      );
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function uploadFiles(files: File[]) {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));

    if (!imageFiles.length) {
      setError("Solo puedes subir archivos de imagen.");
      return;
    }

    if (items.length + imageFiles.length > maxImages) {
      setError("Puedes agregar hasta " + maxImages + " imágenes por producto.");
      return;
    }

    setError("");
    let workingItems = [...items];

    for (const file of imageFiles) {
      const id = crypto.randomUUID();
      let uploadFile = file;
      let localPreview = URL.createObjectURL(file);

      const uploadingItem: ImageItem = {
        id,
        name: file.name,
        url: "",
        alt: file.name.replace(/\.[^.]+$/, ""),
        isPrimary: items.length === 0 && !items.some((item) => item.isPrimary),
        localPreview,
        progress: 0,
        uploading: true,
      };

      const withUploading = [...workingItems, uploadingItem];
      workingItems = withUploading;
      emit(withUploading);

      try {
        uploadFile = await optimizeImage(file);

        if (uploadFile !== file) {
          URL.revokeObjectURL(localPreview);
          localPreview = URL.createObjectURL(uploadFile);

          const optimizedItem = workingItems.map((item) =>
            item.id === id ? { ...item, localPreview, name: uploadFile.name } : item,
          );
          workingItems = optimizedItem;
          emit(optimizedItem);
        }

        const blob = await upload(uploadFile.name, uploadFile, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          clientPayload: JSON.stringify({ purpose: "product-image" }),
          onUploadProgress(event) {
            setItems((current) =>
              current.map((item) =>
                item.id === id ? { ...item, progress: event.percentage } : item,
              ),
            );
          },
        });

        const current = workingItems.filter((item) => item.id !== id);
        const uploaded: ImageItem = {
          ...uploadingItem,
          url: blob.url,
          // Once the upload finishes, render the real Blob URL instead of
          // the temporary object URL (which is revoked below).
          localPreview: undefined,
          progress: 100,
          uploading: false,
        };

        const next = ensurePrimary([...current, uploaded]);
        workingItems = next;
        if (localPreview) URL.revokeObjectURL(localPreview);
        emit(next);
      } catch (uploadError) {
        if (localPreview) URL.revokeObjectURL(localPreview);
        workingItems = workingItems.filter((item) => item.id !== id);
        emit(ensurePrimary(workingItems));
        console.error(uploadError);

        const message =
          uploadError instanceof Error ? uploadError.message.toLowerCase() : "";

        if (
          message.includes("client token") ||
          message.includes("access denied") ||
          message.includes("unauthorized") ||
          message.includes("forbidden")
        ) {
          setError(
            "Vercel Blob no está conectado o autorizado para este entorno de Vercel.",
          );
        } else {
          setError("No pudimos subir " + file.name + ".");
        }
      }
    }
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    void uploadFiles(files);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    void uploadFiles(Array.from(event.dataTransfer.files));
  }

  function handlePaste(event: ClipboardEvent) {
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;

    const files = Array.from(clipboardData.files);
    if (!files.length) return;

    event.preventDefault();
    void uploadFiles(files);
  }

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  });

  async function importFromUrl(event: FormEvent) {
    event.preventDefault();

    const url = urlValue.trim();
    if (!url) return;

    if (items.length >= maxImages) {
      setError("Has alcanzado el máximo de " + maxImages + " imágenes.");
      return;
    }

    setUrlLoading(true);
    setError("");

    try {
      const response = await api.post<{ ok: true; blob: { url: string } }>("/blob/import", { url });
      const newItem: ImageItem = {
        id: crypto.randomUUID(),
        name: "Imagen desde URL",
        url: response.data.blob.url,
        alt: "Imagen del producto",
        isPrimary: items.length === 0,
      };

      emit(ensurePrimary([...items, newItem]));
      setUrlValue("");
    } catch (requestError: any) {
      setError(
        requestError?.response?.data?.message ??
          "No pudimos importar la imagen desde esa URL.",
      );
    } finally {
      setUrlLoading(false);
    }
  }

  async function removeImage(item: ImageItem) {
    try {
      if (item.url) {
        await api.post("/blob/delete", { url: item.url });
      }
    } catch (requestError) {
      console.error(requestError);
    }

    const next = items.filter((current) => current.id !== item.id);
    emit(ensurePrimary(next));

    if (preview?.id === item.id) setPreview(null);
  }

  function setPrimary(itemId: string) {
    const next = items.map((item) => ({
      ...item,
      isPrimary: item.id === itemId,
    }));
    emit(next);
  }

  return (
    <div className="image-uploader">
      <div
        className={dragActive ? "image-dropzone drag-active" : "image-dropzone"}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (event.currentTarget === event.target) setDragActive(false);
        }}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          multiple
          hidden
          onChange={handleInput}
        />

        <div className="image-dropzone-icon"><UploadCloud size={22} /></div>
        <strong>Arrastra tus imágenes aquí</strong>
        <span>o haz clic para explorar los archivos</span>
        <small>
          También puedes pegar una captura o un archivo directamente con Ctrl/Cmd + V.
        </small>
      </div>

      <div className="image-url-row">
        <div className="image-url-input">
          <ExternalLink size={15} />
          <input
            value={urlValue}
            onChange={(event) => setUrlValue(event.target.value)}
            placeholder="Pega aquí la URL de una imagen..."
            onClick={(event) => event.stopPropagation()}
          />
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={importFromUrl}
          disabled={urlLoading || !urlValue.trim()}
        >
          {urlLoading ? <Loader2 size={15} className="spin" /> : <Clipboard size={15} />}
          {urlLoading ? "Importando..." : "Importar URL"}
        </button>
      </div>

      {error ? <div className="auth-error">{error}</div> : null}

      {items.length ? (
        <div className="image-grid">
          {items.map((item) => (
            <div className={item.isPrimary ? "image-tile primary" : "image-tile"} key={item.id}>
              <button
                type="button"
                className="image-tile-preview"
                onClick={(event) => {
                  event.stopPropagation();
                  if (item.url) setPreview(item);
                }}
                disabled={!item.url}
              >
                {item.localPreview || item.url ? (
                  <img src={item.localPreview || item.url} alt={item.alt} />
                ) : (
                  <ImagePlus size={22} />
                )}
                {item.uploading ? (
                  <div className="image-upload-overlay">
                    <Loader2 size={18} className="spin" />
                    <span>{Math.round(item.progress ?? 0)}%</span>
                  </div>
                ) : (
                  <span className="image-hover-action"><ZoomIn size={16} /></span>
                )}
              </button>

              <div className="image-tile-footer">
                <button
                  type="button"
                  className={item.isPrimary ? "image-primary-button active" : "image-primary-button"}
                  onClick={() => !item.uploading && setPrimary(item.id)}
                  disabled={item.uploading}
                  title="Usar como imagen principal"
                >
                  <Star size={13} fill={item.isPrimary ? "currentColor" : "none"} />
                  {item.isPrimary ? "Principal" : "Principal"}
                </button>
                <button
                  type="button"
                  className="image-delete-button"
                  onClick={() => void removeImage(item)}
                  disabled={item.uploading}
                  title="Eliminar imagen"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="image-empty-help">
          <ImagePlus size={17} />
          <span>La primera imagen será principal. Puedes cambiarla en cualquier momento.</span>
        </div>
      )}

      <div className="image-uploader-meta">
        <span>{items.length}/{maxImages} imágenes</span>
        <span>Se optimizan automáticamente a WebP cuando conviene · máximo 10 MB de entrada</span>
      </div>

      {preview ? (
        <div className="image-modal-backdrop" onClick={() => setPreview(null)}>
          <div className="image-preview-modal" onClick={(event) => event.stopPropagation()}>
            <div className="image-preview-modal-head">
              <strong>{preview.name}</strong>
              <button type="button" className="icon-button" onClick={() => setPreview(null)} aria-label="Cerrar">
                <X size={18} />
              </button>
            </div>
            <div className="image-preview-modal-body">
              <img src={preview.url} alt={preview.alt} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
