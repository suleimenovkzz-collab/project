export async function fetchServices() {
  const response = await fetch("/api/services");
  if (!response.ok) throw new Error("Ошибка загрузки");
  const services = await response.json();
  return Array.isArray(services) ? services : [];
}
