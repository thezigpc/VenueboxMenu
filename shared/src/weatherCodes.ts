// WMO weather interpretation codes (what Open-Meteo returns) → words and an icon name.
// Icons are drawn as inline SVG on the client: TVs on a box render in a headless Chromium
// that may have no color emoji font.

export type WeatherIcon = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";

export function describeWeather(code: number): { text: string; icon: WeatherIcon } {
  switch (code) {
    case 0:
      return { text: "Clear", icon: "clear" };
    case 1:
      return { text: "Mostly clear", icon: "partly" };
    case 2:
      return { text: "Partly cloudy", icon: "partly" };
    case 3:
      return { text: "Cloudy", icon: "cloudy" };
    case 45:
    case 48:
      return { text: "Fog", icon: "fog" };
    case 51:
    case 53:
    case 55:
      return { text: "Drizzle", icon: "drizzle" };
    case 56:
    case 57:
      return { text: "Freezing drizzle", icon: "drizzle" };
    case 61:
      return { text: "Light rain", icon: "rain" };
    case 63:
      return { text: "Rain", icon: "rain" };
    case 65:
      return { text: "Heavy rain", icon: "rain" };
    case 66:
    case 67:
      return { text: "Freezing rain", icon: "rain" };
    case 71:
      return { text: "Light snow", icon: "snow" };
    case 73:
      return { text: "Snow", icon: "snow" };
    case 75:
      return { text: "Heavy snow", icon: "snow" };
    case 77:
      return { text: "Snow grains", icon: "snow" };
    case 80:
      return { text: "Showers", icon: "rain" };
    case 81:
      return { text: "Showers", icon: "rain" };
    case 82:
      return { text: "Heavy showers", icon: "rain" };
    case 85:
    case 86:
      return { text: "Snow showers", icon: "snow" };
    case 95:
      return { text: "Thunderstorms", icon: "storm" };
    case 96:
    case 99:
      return { text: "Thunderstorms, hail", icon: "storm" };
    default:
      return { text: "", icon: "cloudy" };
  }
}
