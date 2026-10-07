"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BRAND, getStoreImageSrc } from "@/lib/brand";
import { normalizeImageUrl } from "@/lib/menu/placeholders";
import { useT } from "@/components/providers/locale-provider";
import { useSettings } from "@/hooks/useSettings";
import { useBanners } from "@/hooks/useProducts";
import { BannerHero } from "@/features/catalog/banner-hero";

export function HeroBanner() {
  const t = useT();
  const { settings, loading: settingsLoading } = useSettings();
  const { banners, loading: bannersLoading } = useBanners();
  const [bannerIndex, setBannerIndex] = useState(0);

  useEffect(() => {
    if (banners.length <= 1) return;
    const timer = setInterval(
      () => setBannerIndex((current) => (current + 1) % banners.length),
      6000
    );
    return () => clearInterval(timer);
  }, [banners.length]);

  useEffect(() => {
    if (bannerIndex >= banners.length) setBannerIndex(0);
  }, [bannerIndex, banners.length]);

  const scrollToMenu = () => {
    document.getElementById("menu")?.scrollIntoView({ behavior: "smooth" });
  };

  if (settingsLoading || bannersLoading) {
    return (
      <Skeleton className="mx-4 mt-3 h-[min(38vh,240px)] rounded-3xl md:mx-8 md:mt-8 md:h-[480px] lg:mx-auto lg:max-w-[1400px]" />
    );
  }

  const activeBanner = banners[bannerIndex];
  if (activeBanner) {
    return (
      <section className="relative mx-4 mt-3 md:mx-8 md:mt-8 lg:mx-auto lg:max-w-[1400px]">
        <div className="md:hidden">
          <BannerHero banner={activeBanner} device="mobile" />
        </div>
        <div className="hidden md:block">
          <BannerHero banner={activeBanner} device="desktop" />
        </div>
        {banners.length > 1 && (
          <div className="absolute inset-x-0 bottom-4 z-20 flex justify-center gap-2">
            {banners.map((banner, index) => (
              <button
                key={banner.id}
                type="button"
                onClick={() => setBannerIndex(index)}
                aria-label={`${index + 1}`}
                className={`h-2.5 rounded-full transition-all ${
                  index === bannerIndex ? "w-7 bg-turquoise" : "w-2.5 bg-white/70"
                }`}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  const rawImageSrc = getStoreImageSrc(settings?.storeImageUrl);
  let imageSrc = normalizeImageUrl(rawImageSrc) || "/meskahphoto.png";
  if (imageSrc === "/store.jpg") imageSrc = "/meskahphoto.png";

  return (
    <section className="mx-4 mt-3 md:mx-8 md:mt-8 lg:mx-auto lg:max-w-[1400px]">
      <div className="overflow-hidden rounded-3xl bg-warm-white shadow-soft ring-1 ring-beige-dark/10">
        <div className="grid min-h-[200px] md:min-h-[480px] lg:grid-cols-2 lg:min-h-[500px]">
          {/* Text */}
          <motion.div
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col justify-center px-5 py-6 md:px-10 md:py-12 lg:px-14"
          >
            <p className="text-caption mb-3 uppercase tracking-[0.2em] text-turquoise">
              {t("hero.badge")}
            </p>
            <h1 className="heading-display text-dark-brown">
              {settings?.storeName ?? BRAND.name}
            </h1>
            <p className="text-body mt-4 max-w-md text-base leading-relaxed md:text-lg">
              {t("brand.taglineAlt")}
              <span className="mx-2 text-coffee/30">·</span>
              {t("brand.tagline")}
            </p>
            <div className="mt-8">
              <Button
                variant="turquoise"
                size="lg"
                className="h-12 rounded-full px-8 text-base shadow-soft transition-transform hover:scale-[1.02]"
                onClick={scrollToMenu}
              >
                {t("hero.orderNow")}
                <ArrowRight className="ms-2 h-4 w-4 rtl:rotate-180" strokeWidth={1.75} />
              </Button>
            </div>
          </motion.div>

          {/* Image */}
          <motion.div
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="relative min-h-[200px] lg:min-h-full"
          >
            <Image
              src={imageSrc}
              alt={settings?.storeName ?? BRAND.name}
              fill
              unoptimized={imageSrc.includes("firebasestorage")}
              priority
              className="object-cover"
              sizes="(max-width: 1024px) 100vw, 50vw"
            />
            <div className="absolute inset-0 bg-gradient-to-l from-transparent via-transparent to-warm-white/20 rtl:bg-gradient-to-r" />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
