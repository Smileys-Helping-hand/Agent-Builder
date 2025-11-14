"use client";

import { ReactNode, useEffect, useRef } from "react";

import heroImages, { defaultHeroImage } from "../../theme/heroImages";

type HeroSectionProps = {
  image?: string | null;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
};

const HeroSection = ({ image, title, subtitle, actions, className }: HeroSectionProps) => {
  const backgroundRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = backgroundRef.current;
    if (!node) return;

    const handleScroll = () => {
      const offset = window.scrollY;
      node.style.backgroundPosition = `center ${Math.round(offset * 0.2)}px`;
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const resolvedImage = image ?? defaultHeroImage ?? heroImages.story;

  return (
    <div
      ref={backgroundRef}
      className={`hero-bg parallax-3d ${className ?? "rounded-t-2xl"}`}
      style={{ backgroundImage: `url(${resolvedImage})` }}
    >
      <div className="hero-overlay">
        <div className="hero-copy">
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="hero-actions">{actions}</div> : null}
      </div>
    </div>
  );
};

export default HeroSection;

