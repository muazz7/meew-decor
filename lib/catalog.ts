export type Product = {
  id: string; name: string; category: string; image: string; description: string;
  details: string[]; sourceUrl: string; price: number | null; note: string;
};
export const business = {
  name: 'Meew Decor', phone: '+8801793097608', displayPhone: '01793-097608',
  email: 'meewcraftdecor@gmail.com', address: 'Bosila, Mohammadpur, Dhaka, Bangladesh',
  facebook: 'https://www.facebook.com/people/Meew-Decor/61590528366514/',
  messenger: 'https://m.me/61590528366514',
  tagline: 'প্রতিটি ঘরের জন্য মনোরম সাজসজ্জা',
};
export const products: Product[] = [
  {id:'sculptural-floor-lamp', name:'Sculptural Floor Lamp', category:'Lighting', image:'/images/sculptural-lamp.jpg', note:'A softer kind of statement', price:null,
   description:'A warm glow, a sculptural silhouette. This tall, dark-toned lamp brings a little atmosphere to the corner of a living room or your favourite reading spot.',
   details:['Tall, open-frame design','Light-toned cylindrical shade','Confirm dimensions, finish and bulb details with the shop'],sourceUrl:'https://www.facebook.com/photo.php?fbid=122163157833350945'},
  {id:'bangle-organiser',name:'Wooden Bangle Organiser',category:'Organisers',image:'/images/bangle-organiser.jpg',note:'Every little thing, in place',price:null,
   description:'Give your favourite bangles a place of their own. A warm wooden display with three rails and a lower tray makes getting ready feel a little more considered.',
   details:['Three display rails and a lower tray','Handle-shaped detail at the top','Bangles shown are styling accessories; confirm what is included'],sourceUrl:'https://www.facebook.com/photo.php?fbid=122162498397350945'},
  {id:'woven-planter',name:'Woven Basket & Stand',category:'Natural textures',image:'/images/woven-planter.jpg',note:'Texture for a quiet corner',price:null,
   description:'Natural-looking woven texture meets a simple wooden stand. A relaxed accent for a sunlit corner, an entryway, or beside your favourite chair.',
   details:['Textured, basket-shaped design','Raised on a wooden stand','Confirm material, size, liner and intended use before ordering'],sourceUrl:'https://www.facebook.com/photo.php?fbid=122162038281350945'},
  {id:'tripod-floor-lamp',name:'Tripod Floor Lamp',category:'Lighting',image:'/images/tripod-lamp.jpg',note:'Set the mood for slow evenings',price:null,
   description:'An easy way to make a room feel welcoming. A clean tripod silhouette and a softly glowing shade create a cosy spot to settle in at the end of the day.',
   details:['Wooden tripod-style stand','Light-toned drum shade','Confirm height, finish, bulb and electrical specifications'],sourceUrl:'https://www.facebook.com/photo.php?fbid=122162133747350945'}
];
