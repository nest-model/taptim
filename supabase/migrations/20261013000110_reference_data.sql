-- TAPTIM · 0110 · Reference data (production data, not test seed)
-- New cities/districts/categories are added here (or by admins) — never hard-coded in components.

insert into public.cities (id, name_ru, name_kk, is_active, sort) values
  ('shymkent', 'Шымкент', 'Шымкент', true, 1),
  ('almaty', 'Алматы', 'Алматы', false, 2),
  ('astana', 'Астана', 'Астана', false, 3)
on conflict (id) do nothing;

-- Administrative districts of Shymkent + "not sure" option.
insert into public.districts (id, city_id, name_ru, name_kk, sort) values
  ('shym-abay', 'shymkent', 'Абайский район', 'Абай ауданы', 1),
  ('shym-al-farabi', 'shymkent', 'Аль-Фарабийский район', 'Әл-Фараби ауданы', 2),
  ('shym-enbekshi', 'shymkent', 'Енбекшинский район', 'Еңбекші ауданы', 3),
  ('shym-karatau', 'shymkent', 'Каратауский район', 'Қаратау ауданы', 4),
  ('shym-turan', 'shymkent', 'Туранский район', 'Тұран ауданы', 5),
  ('shym-unknown', 'shymkent', 'Не знаю / по всему городу', 'Білмеймін / бүкіл қала', 99)
on conflict (id) do nothing;

insert into public.categories (id, name_ru, name_kk, icon, listing_types, is_sensitive, allow_photos, sort) values
  ('electronics',   'Электроника',          'Электроника',            'smartphone',   '{lost,found,giveaway,exchange,wanted}', false, true, 10),
  ('phones',        'Телефоны и планшеты',  'Телефондар мен планшеттер', 'tablet-smartphone', '{lost,found}',             false, true, 11),
  ('documents',     'Документы и ключи',    'Құжаттар мен кілттер',   'key-round',    '{lost,found}',                          true,  false, 20),
  ('wallets',       'Кошельки и карты',     'Әмияндар мен карталар',  'wallet',       '{lost,found}',                          true,  true, 21),
  ('bags',          'Сумки и аксессуары',   'Сөмкелер мен аксессуарлар', 'briefcase', '{lost,found,giveaway,exchange,wanted}', false, true, 30),
  ('jewelry',       'Украшения и часы',     'Әшекейлер мен сағаттар', 'watch',        '{lost,found}',                          false, true, 31),
  ('clothes',       'Одежда и обувь',       'Киім мен аяқ киім',      'shirt',        '{lost,found,giveaway,exchange,wanted}', false, true, 40),
  ('home',          'Дом и мебель',         'Үй және жиһаз',          'sofa',         '{giveaway,exchange,wanted}',            false, true, 50),
  ('kids',          'Детские вещи',         'Балалар заттары',        'baby',         '{lost,found,giveaway,exchange,wanted}', false, true, 60),
  ('books',         'Книги и учёба',        'Кітаптар және оқу',      'book-open',    '{lost,found,giveaway,exchange,wanted}', false, true, 70),
  ('sport',         'Спорт',                'Спорт',                  'dumbbell',     '{lost,found,giveaway,exchange,wanted}', false, true, 80),
  ('pets',          'Домашние животные',    'Үй жануарлары',          'paw-print',    '{lost,found,giveaway,exchange,wanted}', false, true, 90),
  ('other',         'Прочее',               'Басқа',                  'package',      '{lost,found,giveaway,exchange,wanted}', false, true, 100)
on conflict (id) do nothing;

-- Terms that trigger manual review (Kazakhstan law: weapons, drugs, prescription meds, documents for sale, etc.).
insert into public.blocked_terms (term, note) values
  ('пистолет', 'оружие'), ('оружие', 'оружие'), ('патрон', 'боеприпасы'), ('травмат', 'оружие'),
  ('наркот', 'наркотики'), ('закладк', 'наркотики'), ('марихуан', 'наркотики'), ('спайс', 'наркотики'),
  ('рецептурн', 'лекарства'), ('продам паспорт', 'документы'), ('куплю паспорт', 'документы'),
  ('фальшив', 'подделки'), ('предоплат', 'мошенничество'), ('переведите деньги', 'мошенничество'),
  ('kaspi перевод', 'мошенничество'), ('интим', '18+')
on conflict (term) do nothing;
