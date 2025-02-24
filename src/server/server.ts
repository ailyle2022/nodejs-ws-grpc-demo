import WebSocket from "ws";
import fs from "fs";
import path from "path";
import { sendWsResponse } from "../utils/wsUtils";
import * as grpc from "@grpc/grpc-js";
import { createGrpcClient } from "../utils/grpcUtils";

export class Server {
  public serverId: number = 0;
  public serverType: string;
  public wsPort: number = 0;
  public grpcPort: number = 0;
  private wss: WebSocket.Server | undefined;

  constructor(serverId: number, serverType: string) {
    this.serverId = serverId;
    this.serverType = serverType;
  }

  public startWs(port: number): void {
    this.wsPort = port;
    this.wss = new WebSocket.Server({ port }); // 初始化 wss

    const handlersPath = path.join(
      __dirname,
      "../messageHandlers/" + this.serverType + "/ws/",
    );
    const handlers = fs
      .readdirSync(handlersPath)
      .filter((file) => file.endsWith(".ts") || file.endsWith(".js"))
      .reduce(
        (acc, file) => {
          const messageType = path.basename(file, path.extname(file));
          acc[messageType] = require(path.join(handlersPath, file)).default;
          return acc;
        },
        {} as Record<
          string,
          (ws: WebSocket, data: any, server: Server) => void
        >,
      );

    this.wss.on("connection", (ws) => {
      console.log("New client connected");

      ws.on("message", (message) => {
        try {
          const data = JSON.parse(message.toString());
          console.log(`Received message => ${message}`);

          const handler = handlers![data.messageType];
          if (handler) {
            handler(ws, data.body, this);
          } else {
            sendWsResponse(ws, data.messageType, "暂不支持!");
          }
        } catch (error) {
          console.error("Invalid JSON message received:", error);
          sendWsResponse(ws, "error", "Invalid JSON format");
        }
      });

      ws.on("close", () => {
        console.log("Client disconnected");
      });
    });

    console.log(`WebSocket server is running on ws://localhost:${port}`); // 使用传入的端口号
  }

  public startGrpc(
    port: number,
    serviceDefinition: grpc.ServiceDefinition,
  ): void {
    this.grpcPort = port;
    const grpcHandlersDir = path.join(
      __dirname,
      "../messageHandlers/" + this.serverType + "/grpc",
    );
    const server = new grpc.Server();
    interface Service {
      [key: string]:
        | grpc.handleUnaryCall<any, any>
        | grpc.handleBidiStreamingCall<any, any>;
    }
    const service: Service = {};
    fs.readdirSync(grpcHandlersDir).forEach((file) => {
      if (file.endsWith(".ts") || file.endsWith(".js")) {
        const handlerModule = require(path.join(grpcHandlersDir, file));
        for (const key in handlerModule) {
          if (typeof handlerModule[key] === "function") {
            // 传递 Server 实例给 login 函数
            service[key] = (
              call: grpc.ServerUnaryCall<any, any>,
              callback: grpc.sendUnaryData<any>,
            ) => {
              handlerModule[key](call, callback, this);
            };
          }
        }
      }
    });

    server.addService(serviceDefinition, service);
    server.bindAsync(
      "0.0.0.0:" + port,
      grpc.ServerCredentials.createInsecure(),
      () => {
        console.log("Server running at http://0.0.0.0:" + port);
      },
    );
  }
}
