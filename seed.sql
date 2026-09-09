INSERT OR IGNORE INTO gacha_boxes (id,name,cost_coins,active)
VALUES (1,'Limited Figure Box',10,1),(2,'TCG Box',15,1);

INSERT OR IGNORE INTO gacha_items (box_id,name,rarity,probability,stock) VALUES
(1,'Common Figure','Common',60,100),
(1,'Rare Figure','Rare',25,50),
(1,'Super Rare Figure','Super Rare',10,20),
(1,'Secret Figure','Secret',4,8),
(1,'Ultimate Figure','Ultimate',1,2);
