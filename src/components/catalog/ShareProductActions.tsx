"use client";

import { Image, MessageCircle, Share2 } from "lucide-react";
import { useState } from "react";

type ShareProductActionsProps = {
  title: string;
  description?: string;
  productUrl: string;
  imageUrl?: string;
};

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function ShareProductActions({
  title,
  description,
  productUrl,
  imageUrl,
}: ShareProductActionsProps) {
  const [notice, setNotice] = useState("");

  function getShareData() {
    const url = new URL(productUrl, window.location.origin).toString();
    const text = description?.trim() || "Mira este producto: " + title;
    return { url, text };
  }

  async function handleStatusShare() {
    setNotice("");
    const { url, text } = getShareData();

    if (typeof navigator.share === "function" && imageUrl && typeof File !== "undefined") {
      try {
        const response = await fetch(imageUrl, { mode: "cors", credentials: "omit" });
        if (!response.ok) throw new Error("No se pudo descargar la imagen");
        const blob = await response.blob();
        const mimeType = blob.type.startsWith("image/") ? blob.type : "image/jpeg";
        const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
        const file = new File([blob], "producto-trendinshop." + extension, { type: mimeType });
        const shareText = text + "\n" + url;

        if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
          await navigator.share({ title, text: shareText, files: [file] });
          return;
        }
      } catch (error) {
        if (isAbortError(error)) return;
      }

      try {
        setNotice("Este dispositivo no permitió adjuntar la imagen. Se abrirá la opción para compartir el enlace del producto.");
        await navigator.share({ title, text, url });
        return;
      } catch (error) {
        if (isAbortError(error)) return;
      }
    }

    setNotice("Tu navegador no permite compartir la imagen como archivo. Se abrirá WhatsApp con el enlace del producto.");
    window.open("https://wa.me/?text=" + encodeURIComponent(text + "\n" + url), "_blank", "noopener,noreferrer");
  }

  function handleWhatsAppShare() {
    setNotice("");
    const { url, text } = getShareData();
    window.open("https://wa.me/?text=" + encodeURIComponent(text + "\n" + url), "_blank", "noopener,noreferrer");
  }

  return (
    <div className="share-product-actions">
      <button className="share-product-button share-product-status" type="button" onClick={() => void handleStatusShare()}>
        <Image size={14} />
        Compartir estado
      </button>
      <button className="share-product-button" type="button" onClick={handleWhatsAppShare}>
        <MessageCircle size={14} />
        WhatsApp
      </button>
      {notice ? <span className="share-product-notice" role="status">{notice}</span> : null}
    </div>
  );
}
