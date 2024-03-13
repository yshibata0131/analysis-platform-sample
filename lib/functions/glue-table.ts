import { Construct } from "constructs";
import {
  GlueCatalogTable,
  GlueCatalogTableStorageDescriptorColumns,
} from "../../.gen/providers/aws/glue-catalog-table";

export interface GlueTableProps {
  databaseName: string;
  tableName: string;
  columns: GlueCatalogTableStorageDescriptorColumns[];
}

export const GlueTable = (scope: Construct, params: GlueTableProps) => {
  const tableName = params.tableName;
  new GlueCatalogTable(scope, `${tableName}-table`, {
    name: tableName,
    databaseName: params.databaseName,
    parameters: {
      EXTERNAL: "TRUE",
      "parquet.compression": "SNAPPY",
    },
    storageDescriptor: {
      columns: params.columns,
      inputFormat:
        "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
      outputFormat:
        "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
      serDeInfo: {
        serializationLibrary:
          "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
      },
    },
    tableType: "EXTERNAL_TABLE",
  });
};
