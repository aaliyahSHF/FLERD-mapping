/*
  Pasture boundaries.

  Coordinates are based on pixels from SHF map.png. 
  Reference is a screenshot from Google maps, of the home property.

  Map X = image column
  Map Y = image row

*/


window.PASTURES = [
  {
    id: "1",
    name: "Pasture 1",
    color: "#6aa84f",
    polygon: [[270,250],[390,245],[410,330],[350,350],[290,335]]
  },
  {
    id: "2",
    name: "Pasture 2",
    color: "#3d8b7d",
    polygon: [[270,165],[395,155],[405,240],[265,235]]
  },
  {
    id: "3",
    name: "Pasture 3a",
    color: "#7e57c2",
    polygon: [[410,75],[515,80],[525,180],[410,170]]
  },
  {
    id: "3",
    name: "Pasture 3b",
    color: "#7e57c2",
    polygon: [[515,80],[640,85],[650,185],[525,180]]
  },
  {
    id: "3.5",
    name: "Pasture 3.5",
    color: "#e69138",
    polygon: [[420,195],[585,190],[590,255],[425,260]]
  },
  {
    id: "4",
    name: "Pasture 4",
    color: "#4a86e8",
    polygon: [[430,275],[585,270],[575,450],[435,480]]
  },
  {
    id: "5",
    name: "Pasture 5",
    color: "#cc0000",
    polygon: [[315,335],[420,320],[425,505],[315,520]]
  },
  {
    id: "6",
    name: "Pasture 6",
    color: "#f1c232",
    polygon: [[250,345],[310,335],[315,520],[245,495]]
  },
  {
    id: "7",
    name: "Pasture 7",
    color: "#45818e",
    polygon: [[145,325],[260,350],[245,495],[135,455]]
  }
];

window.PASTURE_CENTROIDS = {
  "1": [342,302],
  "2": [334,199],
  "3": [524,130],
  "3.5": [505,225],
  "4": [506,369],
  "5": [369,420],
  "6": [280,424],
  "7": [196,406]
};
