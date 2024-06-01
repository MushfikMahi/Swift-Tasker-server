const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion } = require("mongodb");
const port = process.env.PORT || 8000;

app.get("/", (req, res) => {
  res.send("Hello from SwiftTasker Server..");
});

app.listen(port, () => {
  console.log(`SwiftTasker is running on port ${port}`);
});
