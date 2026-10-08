const FUZEDFLOW_LOGO_URL = "https://ochqexofahdssmarnict.supabase.co/storage/v1/object/public/logos/FuzedFlowHero.webp";

export default function AuthBrandLogo() {
  return (
    <img
      src={FUZEDFLOW_LOGO_URL}
      alt="FuzedFlow"
      className="mx-auto mb-4 h-24 w-24 object-contain sm:h-28 sm:w-28"
      decoding="async"
      fetchPriority="high"
    />
  );
}
