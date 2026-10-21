// Shared by the app and the server: supermarket sections, starter items,
// and the section-guessing rules. Edit freely.
(function (root) {
  const SECTIONS = [
    'Fruit & Veg', 'Bakery', 'Deli', 'Meat & Seafood', 'Dairy & Eggs',
    'Breakfast', 'Pantry', 'International', 'Snacks & Sweets', 'Drinks',
    'Frozen', 'Health & Beauty', 'Household', 'Baby & Kids', 'Pets', 'Other',
  ];

  const EMOJI = {
    'Fruit & Veg': '🥦', 'Bakery': '🥖', 'Deli': '🧀', 'Meat & Seafood': '🥩',
    'Dairy & Eggs': '🥛', 'Breakfast': '🥣', 'Pantry': '🥫', 'International': '🌶️',
    'Snacks & Sweets': '🍫', 'Drinks': '🧃', 'Frozen': '🧊', 'Health & Beauty': '🧴',
    'Household': '🧻', 'Baby & Kids': '🍼', 'Pets': '🐾', 'Other': '🛒',
  };

  // Starter items so autocomplete is useful from day one.
  const STARTERS = {
    'Fruit & Veg': 'Bananas,Apples,Oranges,Lemons,Limes,Avocados,Tomatoes,Cherry tomatoes,Cucumber,Lettuce,Baby spinach,Rocket,Broccoli,Cauliflower,Carrots,Potatoes,Sweet potato,Onions,Red onion,Garlic,Ginger,Capsicum,Zucchini,Mushrooms,Celery,Spring onions,Coriander,Parsley,Basil,Mint,Corn,Pumpkin,Grapes,Strawberries,Blueberries,Mandarins,Pears,Kiwi fruit,Watermelon,Mango',
    'Bakery': 'Bread,Sourdough,Wraps,Bread rolls,Burger buns,Croissants,Crumpets,English muffins,Bagels,Pita bread',
    'Deli': 'Ham,Salami,Cheddar,Parmesan,Feta,Haloumi,Hummus,Dips,Olives,Prosciutto,Brie',
    'Meat & Seafood': 'Chicken breast,Chicken thighs,Mince,Sausages,Bacon,Steak,Lamb chops,Pork chops,Salmon,Prawns,Whole chicken,Fish fillets',
    'Dairy & Eggs': 'Milk,Eggs,Butter,Yoghurt,Greek yoghurt,Cheese,Cream,Sour cream,Cream cheese,Oat milk,Almond milk,Mozzarella',
    'Breakfast': 'Cereal,Weet-Bix,Oats,Muesli,Honey,Jam,Peanut butter,Vegemite,Maple syrup,Nutella',
    'Pantry': 'Pasta,Spaghetti,Rice,Flour,Sugar,Brown sugar,Olive oil,Vegetable oil,Salt,Pepper,Stock,Tinned tomatoes,Passata,Tomato paste,Chickpeas,Kidney beans,Lentils,Tuna,Baked beans,Coconut milk,Soy sauce,Vinegar,Tomato sauce,BBQ sauce,Mayonnaise,Mustard,Baking powder,Bicarb soda,Vanilla essence,Noodles,Breadcrumbs,Spices,Coffee,Tea',
    'International': 'Curry paste,Tortillas,Taco kit,Fish sauce,Sweet chilli sauce,Sriracha,Rice paper,Miso paste,Sesame oil',
    'Snacks & Sweets': 'Chips,Crackers,Rice crackers,Biscuits,Chocolate,Muesli bars,Popcorn,Nuts,Lollies,Tim Tams,Dried fruit',
    'Drinks': 'Sparkling water,Juice,Soft drink,Cordial,Kombucha,Beer,Wine',
    'Frozen': 'Frozen peas,Frozen veg,Ice cream,Frozen berries,Fish fingers,Frozen pizza,Hash browns,Ice',
    'Health & Beauty': 'Toothpaste,Toothbrush,Shampoo,Conditioner,Soap,Body wash,Deodorant,Sunscreen,Razors,Tissues,Band-aids,Paracetamol,Floss,Moisturiser',
    'Household': 'Toilet paper,Paper towel,Dishwashing liquid,Dishwasher tablets,Laundry liquid,Bin bags,Cling wrap,Foil,Baking paper,Sponges,Spray cleaner,Batteries,Zip lock bags,Light bulbs',
    'Baby & Kids': 'Nappies,Wipes,Baby food,Lunchbox snacks,Squeeze pouches',
    'Pets': 'Dog food,Cat food,Cat litter,Pet treats',
  };

  // Keyword hints for guessing the section of something new.
  const HINTS = {
    'Fruit & Veg': 'fruit,veg,apple,banana,berry,berries,lettuce,salad,herb,tomato,potato,onion,garlic,capsicum,chilli,leek,kale,cabbage,bean sprout,eggplant,peach,plum,nectarine,pineapple,melon,lemon,lime,orange,cherr,spinach,asparagus,beetroot,radish,fennel',
    'Bakery': 'bread,loaf,roll,bun,wrap,muffin,croissant,bagel,scroll,cake,donut,baguette,focaccia',
    'Deli': 'cheese,salami,ham,olive,dip,antipasto,prosciutto,chorizo,pate,pâté',
    'Meat & Seafood': 'chicken,beef,pork,lamb,mince,steak,sausage,snag,bacon,fish,salmon,prawn,tuna steak,turkey,schnitzel,ribs,roast,meatball',
    'Dairy & Eggs': 'milk,egg,butter,yoghurt,yogurt,cream,custard,dairy,kefir',
    'Breakfast': 'cereal,oat,muesli,granola,jam,honey,spread,vegemite,porridge,syrup',
    'Pantry': 'pasta,rice,flour,sugar,oil,salt,stock,tin,can,sauce,beans,lentil,spice,coffee,tea,noodle,vinegar,paste,seasoning,cocoa,yeast,quinoa,couscous',
    'International': 'curry,taco,tortilla,mexican,asian,thai,indian,japanese,miso,kimchi,wasabi,nori',
    'Snacks & Sweets': 'chip,crisp,cracker,biscuit,cookie,choc,lolly,lollies,snack,bar,nut,popcorn,pretzel',
    'Drinks': 'water,juice,soda,soft drink,cola,coke,lemonade,cordial,beer,wine,drink,kombucha',
    'Frozen': 'frozen,ice cream,icecream,ice block,gelato,sorbet,pizza',
    'Health & Beauty': 'tooth,shampoo,conditioner,soap,deodorant,razor,sunscreen,tissue,vitamin,panadol,nurofen,band-aid,plaster,lotion,cotton,tampon,pad,makeup,lip',
    'Household': 'paper,towel,detergent,laundry,dishwash,bin,bag,foil,wrap,clean,sponge,bleach,battery,batteries,bulb,candle,napkin,spray,mop',
    'Baby & Kids': 'nappy,nappies,baby,wipes,pouch,formula',
    'Pets': 'dog,cat,pet,litter,bird seed,fish food',
  };

  const STARTER_INDEX = {};
  for (const [sec, list] of Object.entries(STARTERS)) {
    for (const name of list.split(',')) STARTER_INDEX[name.toLowerCase()] = { name, section: sec };
  }

  function norm(s) {
    return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  // Basic plural folding so "eggs" and "egg" match.
  function key(s) {
    let k = norm(s);
    if (k.length > 3 && k.endsWith('ies')) k = k.slice(0, -3) + 'y';
    else if (k.length > 3 && k.endsWith('es') && /(oes|ches|shes|xes)$/.test(k)) k = k.slice(0, -2);
    else if (k.length > 3 && k.endsWith('s') && !k.endsWith('ss')) k = k.slice(0, -1);
    return k;
  }

  function guessSection(name, learned) {
    const n = norm(name), k = key(name);
    if (learned) {
      if (learned[k] && learned[k].section) return learned[k].section;
    }
    if (STARTER_INDEX[n]) return STARTER_INDEX[n].section;
    for (const s of Object.values(STARTER_INDEX)) if (key(s.name) === k) return s.section;
    // Longest keyword match wins, so "ice cream" beats "cream".
    let best = null, bestLen = 0;
    for (const [sec, words] of Object.entries(HINTS)) {
      for (const w of words.split(',')) {
        if (w && n.includes(w) && w.length > bestLen) { best = sec; bestLen = w.length; }
      }
    }
    return best || 'Other';
  }

  function tidyName(s) {
    const t = String(s || '').trim().replace(/\s+/g, ' ');
    if (!t) return '';
    const starter = STARTER_INDEX[t.toLowerCase()];
    if (starter) return starter.name;
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // "2 milk", "milk x2", "3x eggs" -> { name, qty }
  function parseQty(s) {
    let t = String(s || '').trim(), qty = '';
    let m = t.match(/^(\d+)\s*(x\s+)?(.+)$/i);
    if (m && !/^\d+\s*(g|kg|ml|l|pk|pack)\b/i.test(t)) { qty = m[1]; t = m[3]; }
    else if ((m = t.match(/^(.+?)\s+x\s*(\d+)$/i))) { t = m[1]; qty = m[2]; }
    return { name: tidyName(t), qty };
  }

  const api = { SECTIONS, EMOJI, STARTERS, STARTER_INDEX, guessSection, tidyName, parseQty, key, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Catalog = api;
})(typeof self !== 'undefined' ? self : this);
