export type HeroImageMap = {
  build: string;
  chat: string;
  collaborate: string;
  game: string;
  npc: string;
  player: string;
  simulation: string;
  social: string;
  terrain: string;
  story: string;
  logo: string;
};

const heroImages: HeroImageMap = {
  build: "/branding/ai_core_reactor.png",
  chat: "/branding/voice_console.png",
  collaborate: "/branding/collaboration_nexus.png",
  game: "/branding/roblox_creation_forge.png",
  npc: "/branding/npc_sim_chamber.png",
  player: "/branding/ai_player_map.png",
  simulation: "/branding/ai_core_reactor.png",
  social: "/branding/social_graph.png",
  terrain: "/branding/terrain_generator_engine.png",
  story: "/branding/neon_dashboard_bg.png",
  logo: "/branding/hustle_studio_logo.png"
};

export const defaultHeroImage = heroImages.story;

export default heroImages;
