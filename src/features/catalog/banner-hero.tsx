"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";
import { normalizeImageUrl } from "@/lib/menu/placeholders";
import type { BannerSlide } from "@/types";

function localizedBanner(banner: BannerSlide, locale: "he" | "ar" | "en") {
  const title =
    locale === "he"
      ? banner.title_he || banner.title
      : locale === "ar"
        ? banner.title_ar || banner.title_he || banner.title
        : banner.title_en || banner.title;
  const subtitle =
    locale === "he"
      ? banner.subtitle_he || banner.subtitle
      : locale === "ar"
        ? banner.subtitle_ar || banner.subtitle_he || banner.subtitle
        : banner.subtitle_en || banner.subtitle;
  const button =
    locale === "he"
      ? banner.button_he || banner.cta
      : locale === "ar"
        ? banner.button_ar || banner.button_he || banner.cta
        : banner.button_en || banner.cta;
  return { title, subtitle, button };
}

function bannerHref(banner: BannerSlide): string {
  if (banner.ctaAction === "product" && banner.ctaTargetId) {
    return `/catalog?product=${encodeURIComponent(banner.ctaTargetId)}`;
  }
  if (banner.ctaAction === "category" && banner.ctaTargetId) {
    return `/catalog?category=${encodeURIComponent(banner.ctaTargetId)}`;
  }
  return banner.ctaUrl || "/catalog";
}

export function BannerHero({
  banner,
  device = "desktop",
  interactive = true,
  className,
}: {
  banner: BannerSlide;
  device?: "desktop" | "mobile";
  interactive?: boolean;
  className?: string;
}) {
  const { locale } = useLocale();
  const content = localizedBanner(banner, locale);
  const mobile = device === "mobile";
  const rawImage = mobile ? banner.mobileImage || banner.image : banner.image;
  let image = normalizeImageUrl(rawImage) || "/meskahphoto.png";
  if (image === "/store.jpg") image = "/meskahphoto.png";
  const x = mobile ? banner.mobilePositionX : banner.desktopPositionX;
  const y = mobile ? banner.mobilePositionY : banner.desktopPositionY;
  const zoom = mobile ? banner.mobileZoom : banner.desktopZoom;
  const showButton = banner.ctaAction !== "none" && Boolean(content.button);

  const hero = (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-3xl bg-dark-brown text-warm-white shadow-soft",
        mobile ? "aspect-[16/10] max-h-[38vh] min-h-[160px] w-full" : "aspect-[14/5] w-full",
        className
      )}
    >
      <Image
        src={image}
        alt={content.title}
        fill
        unoptimized={image.includes("firebasestorage")}
        priority={!interactive}
        className="object-cover"
        style={{
          objectPosition: `${x ?? 50}% ${y ?? 50}%`,
          transform: `scale(${zoom ?? 1})`,
        }}
        sizes={mobile ? "390px" : "(max-width: 1024px) 100vw, 1400px"}
      />
      <div className="absolute inset-0 bg-gradient-to-l from-dark-brown/80 via-dark-brown/30 to-transparent rtl:bg-gradient-to-r" />
      <div
        className={cn(
          "relative z-10 flex h-full max-w-xl flex-col justify-center",
          mobile ? "p-6" : "p-8 md:p-12 lg:p-16"
        )}
      >
        <h2 className={cn("font-display font-bold", mobile ? "text-3xl" : "text-3xl md:text-5xl")}>
          {content.title}
        </h2>
        {content.subtitle && (
          <p className={cn("mt-3 leading-relaxed text-warm-white/90", mobile ? "text-base" : "text-lg")}>
            {content.subtitle}
          </p>
        )}
        {showButton && (
          <div className="mt-6">
            <Button asChild={interactive} variant="turquoise" className="rounded-full px-6">
              {interactive ? (
                <Link href={bannerHref(banner)}>
                  {content.button}
                  <ArrowRight className="ms-2 h-4 w-4 rtl:rotate-180" />
                </Link>
              ) : (
                <span>
                  {content.button}
                  <ArrowRight className="ms-2 inline h-4 w-4 rtl:rotate-180" />
                </span>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  return hero;
}
