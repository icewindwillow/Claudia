export const CATEGORIES=["猫咖", "宠物店", "公园", "街巷", "其他"];
export function categoryOf(value){return CATEGORIES.includes(value)?value:'其他';}
export function normalizeCategory(place){return place?{...place,category:categoryOf(place.category)}:place;}
