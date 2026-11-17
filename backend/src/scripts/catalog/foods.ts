// Approximate values per 100 g, from common nutrition tables. Home-cooked
// dishes vary a lot; users can add their own foods with exact label values.

export interface CatalogFood {
  name: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  servingG?: number;
  servingLabel?: string;
}

const f = (
  name: string,
  kcal: number,
  proteinG: number,
  carbsG: number,
  fatG: number,
  servingG?: number,
  servingLabel?: string,
  fiberG = 0,
): CatalogFood => ({ name, kcal, proteinG, carbsG, fatG, fiberG, servingG, servingLabel });

export const foods: CatalogFood[] = [
  // Protein
  f('Egg, whole', 143, 12.6, 0.7, 9.5, 50, '1 large egg'),
  f('Egg white', 52, 10.9, 0.7, 0.2, 33, '1 egg white'),
  f('Chicken breast, cooked', 165, 31, 0, 3.6, 120, '1 piece'),
  f('Chicken thigh, cooked', 209, 26, 0, 10.9, 100),
  f('Chicken curry, home-style', 165, 15, 5, 9.5, 200, '1 bowl'),
  f('Mutton curry, home-style', 190, 17, 4, 12, 200, '1 bowl'),
  f('Fish, grilled (white fish)', 120, 24, 0, 2, 120, '1 fillet'),
  f('Salmon, cooked', 206, 22.1, 0, 12.4, 120, '1 fillet'),
  f('Tuna, canned in water', 116, 25.5, 0, 0.8, 100),
  f('Paneer', 265, 18.3, 1.2, 20.8, 50, '4 cubes'),
  f('Tofu, firm', 144, 17.3, 2.8, 8.7, 100),
  f('Soya chunks, dry', 345, 52, 33, 0.5, 30, '1 handful', 13),
  f('Whey protein', 400, 78, 8, 6, 30, '1 scoop'),
  f('Greek yogurt, plain, non-fat', 59, 10.3, 3.6, 0.4, 150, '1 cup'),
  f('Cottage cheese', 98, 11.1, 3.4, 4.3, 100),
  // Dairy
  f('Milk, whole', 61, 3.2, 4.8, 3.3, 250, '1 glass'),
  f('Milk, toned', 58, 3.1, 4.7, 3, 250, '1 glass'),
  f('Milk, skimmed', 34, 3.4, 5, 0.1, 250, '1 glass'),
  f('Curd (dahi)', 61, 3.5, 4.7, 3.3, 150, '1 katori'),
  f('Cheddar cheese', 403, 24.9, 1.3, 33.1, 20, '1 slice'),
  f('Butter', 717, 0.9, 0.1, 81.1, 10, '1 tsp'),
  f('Ghee', 900, 0, 0, 99.5, 5, '1 tsp'),
  // Grains and breads
  f('Roti / chapati', 300, 10, 50, 7, 40, '1 roti', 6),
  f('Paratha, plain', 326, 7.5, 45, 13, 80, '1 paratha', 4),
  f('White rice, cooked', 130, 2.7, 28.2, 0.3, 150, '1 cup', 0.4),
  f('Brown rice, cooked', 123, 2.7, 25.6, 1, 150, '1 cup', 1.6),
  f('Oats, dry', 379, 13.2, 67.7, 6.5, 40, '1/2 cup', 10),
  f('Poha, cooked', 158, 3, 27, 4.5, 150, '1 plate', 1.5),
  f('Idli', 146, 4.5, 30, 0.6, 40, '1 idli', 1),
  f('Dosa, plain', 168, 3.9, 29, 3.7, 90, '1 dosa', 1),
  f('Khichdi', 120, 4.5, 21, 2, 200, '1 bowl', 2),
  f('Chicken biryani', 187, 9, 22, 7, 300, '1 plate', 1),
  f('Whole wheat bread', 252, 12.4, 42.7, 3.5, 32, '1 slice', 6),
  f('White bread', 265, 9, 49, 3.2, 25, '1 slice', 2.7),
  f('Pasta, cooked', 158, 5.8, 30.9, 0.9, 150, '1 cup', 1.8),
  f('Quinoa, cooked', 120, 4.4, 21.3, 1.9, 150, '1 cup', 2.8),
  // Lentils and legumes
  f('Dal (lentils), cooked', 116, 9, 20.1, 0.4, 150, '1 katori', 7.9),
  f('Rajma (kidney beans), cooked', 127, 8.7, 22.8, 0.5, 150, '1 katori', 6.4),
  f('Chana (chickpeas), cooked', 164, 8.9, 27.4, 2.6, 150, '1 katori', 7.6),
  f('Sambar', 60, 3, 8, 1.8, 150, '1 katori', 2),
  // Vegetables
  f('Potato, boiled', 87, 1.9, 20.1, 0.1, 150, '1 medium', 1.8),
  f('Sweet potato, baked', 90, 2, 20.7, 0.2, 130, '1 medium', 3.3),
  f('Spinach, raw', 23, 2.9, 3.6, 0.4, 30, '1 cup', 2.2),
  f('Broccoli, raw', 34, 2.8, 6.6, 0.4, 90, '1 cup', 2.6),
  f('Mixed vegetable sabzi', 90, 2.5, 10, 4.5, 150, '1 katori', 3),
  f('Avocado', 160, 2, 8.5, 14.7, 100, '1/2 avocado', 6.7),
  // Fruit
  f('Banana', 89, 1.1, 22.8, 0.3, 118, '1 medium', 2.6),
  f('Apple', 52, 0.3, 13.8, 0.2, 182, '1 medium', 2.4),
  f('Orange', 47, 0.9, 11.8, 0.1, 130, '1 medium', 2.4),
  f('Mango', 60, 0.8, 15, 0.4, 165, '1 cup', 1.6),
  f('Dates', 282, 2.5, 75, 0.4, 8, '1 date', 8),
  // Nuts, spreads, fats
  f('Almonds', 579, 21.2, 21.6, 49.9, 28, '1 handful', 12.5),
  f('Peanuts, roasted', 585, 23.7, 21.5, 49.7, 28, '1 handful', 8),
  f('Peanut butter', 588, 25, 20, 50, 16, '1 tbsp', 6),
  f('Olive oil', 884, 0, 0, 100, 13.5, '1 tbsp'),
  f('Honey', 304, 0.3, 82.4, 0, 21, '1 tbsp'),
  f('Sugar', 387, 0, 100, 0, 4, '1 tsp'),
  // Drinks and snacks
  f('Coffee, black', 2, 0.1, 0, 0, 240, '1 cup'),
  f('Chai (milk and sugar)', 37, 1.2, 5.2, 1.2, 150, '1 cup'),
  f('Green tea', 1, 0.2, 0, 0, 240, '1 cup'),
  f('Coconut water', 19, 0.7, 3.7, 0.2, 240, '1 glass'),
  f('Protein bar', 350, 30, 35, 10, 60, '1 bar', 5),
];
