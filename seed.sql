INSERT OR IGNORE INTO boxes (id,name,description,price_coins,active) VALUES
('box-onepiece','One Piece Treasure Box','Koleksi karakter One Piece.',25,1),
('box-anime','Anime Secret Box','Figure anime pilihan.',20,1),
('box-premium','Kuro Premium','Box premium dengan hadiah terbatas.',50,1);

INSERT OR IGNORE INTO rewards (id,box_id,name,rarity,probability,stock,image) VALUES
('r-op-common','box-onepiece','One Piece Sticker Set','Common',60,100,''),
('r-op-rare','box-onepiece','One Piece Mini Figure','Rare',25,50,''),
('r-op-super','box-onepiece','Luffy Gear Figure','Super Rare',10,20,''),
('r-op-secret','box-onepiece','Zoro Limited Figure','Secret',4,8,''),
('r-op-ultimate','box-onepiece','One Piece Grand Figure','Ultimate',1,2,''),
('r-an-common','box-anime','Anime Acrylic Charm','Common',60,100,''),
('r-an-rare','box-anime','Anime Mini Figure','Rare',25,50,''),
('r-an-super','box-anime','Jujutsu Figure','Super Rare',10,20,''),
('r-an-secret','box-anime','Limited Character Figure','Secret',4,8,''),
('r-an-ultimate','box-anime','Premium Anime Figure','Ultimate',1,2,''),
('r-pr-common','box-premium','Premium Card Pack','Common',60,100,''),
('r-pr-rare','box-premium','Collector Figure','Rare',25,50,''),
('r-pr-super','box-premium','Premium TCG Box','Super Rare',10,20,''),
('r-pr-secret','box-premium','Limited Edition Figure','Secret',4,8,''),
('r-pr-ultimate','box-premium','KuroBox Ultimate Prize','Ultimate',1,2,'');
